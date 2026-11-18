"""Fail-closed Windows handles. No API calls, file reads or writes on import.

The snapshot's CREATE_NEW handle is kept from creation through the consumer.
It shares READ only, never WRITE or DELETE. No ACLs are created or changed.
"""
from __future__ import annotations
from contextlib import ExitStack, contextmanager
from pathlib import Path
import ctypes
from ctypes import wintypes as w
import os
import stat
import tempfile
from public_core import GateError, require, digest, plain_path, tree_sha, read


class FILE_INFO(ctypes.Structure):
    _fields_ = [('attributes', w.DWORD), ('created', w.FILETIME), ('access', w.FILETIME),
                ('written', w.FILETIME), ('volume', w.DWORD), ('sizeHigh', w.DWORD),
                ('sizeLow', w.DWORD), ('links', w.DWORD), ('indexHigh', w.DWORD), ('indexLow', w.DWORD)]


class ACE_HEADER(ctypes.Structure):
    _fields_ = [('kind', w.BYTE), ('flags', w.BYTE), ('size', w.WORD)]


class ACL_INFO(ctypes.Structure):
    _fields_ = [('AceCount', w.DWORD), ('AclBytesInUse', w.DWORD), ('AclBytesFree', w.DWORD)]


def private_descriptor_policy(current_sid,owner_sid,control,aces,*,dacl_present=True,protected=False):
    """Pure conservative policy, separate from actual handle-based extraction."""
    require(owner_sid==current_sid and dacl_present,'PRIVATE_OWNER_OR_DACL_UNPROVEN')
    require(control & 4 and (not protected or control & 0x1000),'PRIVATE_PROTECTED_ROOT_REQUIRED')
    require(bool(aces),'PRIVATE_ACL_UNPROVEN')
    allowed={current_sid,'S-1-5-18','S-1-5-32-544'};user_allow=False
    for kind,sid in aces:
        require(kind in (0,1),'UNSUPPORTED_PRIVATE_ACE')
        if kind==0:
            require(sid in allowed,'PRIVATE_ACL_BROAD_ALLOW');user_allow=user_allow or sid==current_sid
    require(user_allow,'PRIVATE_USER_ACCESS_UNPROVEN')
    return {'ownerCurrentUser':True,'allowTrusteesRestricted':True,'protectedRoot':bool(control & 0x1000)}


class WindowsSecurity:
    """Only instantiated on explicit execute; unsupported APIs/filesystems block.

    DACL proof is deliberately conservative: protected root, current-user owner,
    and every allow ACE restricted to current user, SYSTEM or Administrators.
    Unrecognized ACE forms, NULL DACL and unreadable descriptors are refused.
    Administrators/current-user malicious processes are outside the ACL boundary;
    share-mode handles still reject ordinary concurrent writes/deletes.
    """
    is_mock = False

    def __init__(self):
        require(os.name == 'nt', 'WINDOWS_LOCK_AND_ACL_PROOF_REQUIRED')
        self.k = ctypes.WinDLL('kernel32', use_last_error=True)
        self.a = ctypes.WinDLL('advapi32', use_last_error=True)
        self.k.CreateFileW.argtypes = [w.LPCWSTR,w.DWORD,w.DWORD,ctypes.c_void_p,w.DWORD,w.DWORD,w.HANDLE]
        self.k.CreateFileW.restype = w.HANDLE
        self.k.CloseHandle.argtypes = [w.HANDLE]
        self.k.GetFileInformationByHandle.argtypes = [w.HANDLE,ctypes.POINTER(FILE_INFO)]
        self.k.GetFinalPathNameByHandleW.argtypes = [w.HANDLE,w.LPWSTR,w.DWORD,w.DWORD]
        self.k.ReadFile.argtypes = [w.HANDLE,ctypes.c_void_p,w.DWORD,ctypes.POINTER(w.DWORD),ctypes.c_void_p]
        self.k.WriteFile.argtypes = self.k.ReadFile.argtypes
        self.k.FlushFileBuffers.argtypes = [w.HANDLE]
        self.k.SetFilePointerEx.argtypes = [w.HANDLE,ctypes.c_longlong,ctypes.c_void_p,w.DWORD]
        self.k.GetCurrentProcess.restype = w.HANDLE
        self.k.GetWindowsDirectoryW.argtypes = [w.LPWSTR,w.UINT]
        self.k.LocalFree.argtypes = [ctypes.c_void_p]
        self.a.OpenProcessToken.argtypes = [w.HANDLE,w.DWORD,ctypes.POINTER(w.HANDLE)]
        self.a.GetTokenInformation.argtypes = [w.HANDLE,ctypes.c_int,ctypes.c_void_p,w.DWORD,ctypes.POINTER(w.DWORD)]
        self.a.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p,ctypes.POINTER(w.LPWSTR)]
        self.a.GetSecurityInfo.argtypes = [w.HANDLE,ctypes.c_int,w.DWORD,ctypes.POINTER(ctypes.c_void_p),ctypes.POINTER(ctypes.c_void_p),ctypes.POINTER(ctypes.c_void_p),ctypes.POINTER(ctypes.c_void_p),ctypes.POINTER(ctypes.c_void_p)]
        self.a.GetSecurityDescriptorControl.argtypes = [ctypes.c_void_p,ctypes.POINTER(w.WORD),ctypes.POINTER(w.DWORD)]
        self.a.GetAclInformation.argtypes = [ctypes.c_void_p,ctypes.c_void_p,w.DWORD,ctypes.c_int]
        self.a.GetAce.argtypes = [ctypes.c_void_p,w.DWORD,ctypes.POINTER(ctypes.c_void_p)]
        self.current_sid = self._current_sid()

    def system_root(self):
        value=ctypes.create_unicode_buffer(32768)
        count=self.k.GetWindowsDirectoryW(value,len(value))
        require(0<count<len(value),'TRUSTED_SYSTEM_DIRECTORY_UNPROVEN')
        return plain_path(value.value)

    def receipt_stream_info(self,stream,expected_path):
        """Inspect the already-open CRT receipt handle without reopening its path.

        The Python stream owns this handle; this method never closes it or
        changes its file position. The caller retains the parent-chain locks.
        """
        require(os.name=='nt','WINDOWS_RECEIPT_HANDLE_PROOF_REQUIRED')
        import msvcrt
        handle=msvcrt.get_osfhandle(stream.fileno())
        require(handle not in (-1,None),'RECEIPT_HANDLE_UNPROVEN')
        lease=WindowsLease(self,Path(expected_path),handle)
        info=lease.info()
        info['finalPath']=lease.final_path()
        return info

    def _sid(self, pointer):
        value = w.LPWSTR()
        require(self.a.ConvertSidToStringSidW(pointer, ctypes.byref(value)), 'ACL_SID_UNREADABLE')
        try: return value.value
        finally: self.k.LocalFree(ctypes.cast(value,ctypes.c_void_p))

    def _current_sid(self):
        token = w.HANDLE()
        require(self.a.OpenProcessToken(self.k.GetCurrentProcess(),8,ctypes.byref(token)), 'TOKEN_OWNER_PROOF_FAILED')
        try:
            size=w.DWORD(); self.a.GetTokenInformation(token,1,None,0,ctypes.byref(size))
            require(0 < size.value < 65536, 'TOKEN_OWNER_PROOF_FAILED')
            buf=ctypes.create_string_buffer(size.value)
            require(self.a.GetTokenInformation(token,1,buf,size,ctypes.byref(size)), 'TOKEN_OWNER_PROOF_FAILED')
            return self._sid(ctypes.cast(buf,ctypes.POINTER(ctypes.c_void_p))[0])
        finally: self.k.CloseHandle(token)

    def prove_private(self, lease, protected=False):
        owner=ctypes.c_void_p(); dacl=ctypes.c_void_p(); sd=ctypes.c_void_p()
        require(self.a.GetSecurityInfo(lease.handle,1,5,ctypes.byref(owner),None,ctypes.byref(dacl),None,ctypes.byref(sd)) == 0,
                'PRIVATE_ACL_UNPROVEN')
        try:
            require(owner.value and self._sid(owner) == self.current_sid and dacl.value, 'PRIVATE_OWNER_OR_DACL_UNPROVEN')
            control=w.WORD(); revision=w.DWORD()
            require(self.a.GetSecurityDescriptorControl(sd,ctypes.byref(control),ctypes.byref(revision)), 'PRIVATE_ACL_UNPROVEN')
            require(control.value & 4 and (not protected or control.value & 0x1000), 'PRIVATE_PROTECTED_ROOT_REQUIRED')
            info=ACL_INFO()
            require(self.a.GetAclInformation(dacl,ctypes.byref(info),ctypes.sizeof(info),2), 'PRIVATE_ACL_UNPROVEN')
            require(info.AceCount > 0, 'PRIVATE_ACL_UNPROVEN')
            aces=[]
            for index in range(info.AceCount):
                ptr=ctypes.c_void_p()
                require(self.a.GetAce(dacl,index,ctypes.byref(ptr)), 'PRIVATE_ACL_UNPROVEN')
                header=ctypes.cast(ptr,ctypes.POINTER(ACE_HEADER)).contents
                require(header.kind in (0,1) and header.size >= 12, 'UNSUPPORTED_PRIVATE_ACE')
                sid=self._sid(ptr.value+8)
                aces.append((header.kind,sid))
            proof=private_descriptor_policy(self.current_sid,self._sid(owner),control.value,aces,dacl_present=bool(dacl.value),protected=protected)
        finally:
            if sd.value: self.k.LocalFree(sd)
        return proof

    @contextmanager
    def lock(self, path, *, create=False, directory=False, ancestor=False):
        path=Path(path).absolute()
        if not create: plain_path(path)
        else: plain_path(path.parent); require(not path.exists(),'NEW_SNAPSHOT_REQUIRED')
        # Parents deny deletion/rename. Files (and the controlled root) also deny writes.
        sharing=3 if ancestor else 1
        access=0x80000000 | 0x00020000 | (0x40000000 if create else 0)
        flags=0x00200000 | (0x02000000 if directory else 0)
        handle=self.k.CreateFileW(str(path),access,sharing,None,1 if create else 3,flags,None)
        require(handle not in (None,ctypes.c_void_p(-1).value),'WINDOWS_LOCK_UNPROVEN')
        lease=WindowsLease(self,path,handle,create)
        try:
            info=lease.info(); require(not info['reparse'],'REPARSE_OR_LINKED_PATH_FORBIDDEN')
            expected=os.path.normcase(os.path.abspath(path))
            require(os.path.normcase(lease.final_path()) == expected,'LOCKED_PATH_IDENTITY_MISMATCH')
            yield lease
            require(lease.info()['identity'] == info['identity'],'LOCKED_FILE_IDENTITY_CHANGED')
        finally: self.k.CloseHandle(handle)

    @contextmanager
    def path(self, path, **kwargs):
        path=Path(path).absolute()
        with ExitStack() as stack:
            # No enumeration: exact path ancestors only, root downward.
            for parent in reversed(path.parents):
                stack.enter_context(self.lock(parent,directory=True,ancestor=True))
            yield stack.enter_context(self.lock(path,**kwargs))


class WindowsLease:
    def __init__(self,security,path,handle,writable=False):
        self.security=security; self.path=path; self.handle=handle; self.writable=writable; self.sealed=False

    def info(self):
        info=FILE_INFO(); require(self.security.k.GetFileInformationByHandle(self.handle,ctypes.byref(info)),'LOCK_FILE_ID_UNPROVEN')
        return dict(identity=f'{info.volume:08x}:{info.indexHigh:08x}{info.indexLow:08x}',
                    bytes=(info.sizeHigh<<32)|info.sizeLow,reparse=bool(info.attributes & 0x400))

    def final_path(self):
        buf=ctypes.create_unicode_buffer(32768)
        n=self.security.k.GetFinalPathNameByHandleW(self.handle,buf,len(buf),0)
        require(0<n<len(buf),'LOCKED_PATH_IDENTITY_UNPROVEN')
        value=buf.value
        require(not value.startswith('\\\\?\\UNC\\'),'LOCAL_CONTROLLED_VOLUME_REQUIRED')
        return value[4:] if value.startswith('\\\\?\\') else value

    def read(self):
        require(self.security.k.SetFilePointerEx(self.handle,0,None,0),'LOCK_SEEK_FAILED')
        result=[]; total=0
        while True:
            buf=ctypes.create_string_buffer(65536); used=w.DWORD()
            require(self.security.k.ReadFile(self.handle,buf,len(buf),ctypes.byref(used),None),'LOCK_READ_FAILED')
            if not used.value: break
            total+=used.value; require(total<=2_000_000_000,'LOCK_INPUT_TOO_LARGE'); result.append(buf.raw[:used.value])
        return b''.join(result)

    def write_once(self, content):
        require(self.writable and not self.sealed and self.info()['bytes']==0,'SNAPSHOT_ALREADY_SEALED')
        require(self.security.k.SetFilePointerEx(self.handle,0,None,0),'LOCK_SEEK_FAILED')
        for offset in range(0,len(content),65536):
            chunk=content[offset:offset+65536]; used=w.DWORD(); buf=ctypes.create_string_buffer(chunk)
            require(self.security.k.WriteFile(self.handle,buf,len(chunk),ctypes.byref(used),None) and used.value==len(chunk),'SNAPSHOT_WRITE_FAILED')
        require(self.security.k.FlushFileBuffers(self.handle),'SNAPSHOT_FLUSH_FAILED'); self.sealed=True
        require(self.read()==content,'SNAPSHOT_BYTES_MISMATCH')


class PrivateArea:
    def __init__(self,security,root): self.security=security; self.root=Path(root).absolute(); self.stack=ExitStack();self.leases=[]
    def __enter__(self):
        try:
            root=self.stack.enter_context(self.security.path(self.root,directory=True))
            self.security.prove_private(root,protected=True)
            self.leases.append((root,True))
            self.directory=Path(tempfile.mkdtemp(prefix='v2-run-',dir=self.root))
            child=self.stack.enter_context(self.security.path(self.directory,directory=True))
            self.security.prove_private(child)
            self.leases.append((child,False))
            return self
        except BaseException:
            self.stack.close(); raise
    def __exit__(self,*args): return self.stack.__exit__(*args)
    def snapshot(self,name,content):
        require(Path(name).name == name and name not in ('','.','..'),'UNSAFE_SNAPSHOT_NAME')
        lease=self.stack.enter_context(self.security.path(self.directory/name,create=True))
        proof=self.security.prove_private(lease)
        self.leases.append((lease,False))
        lease.write_once(content)
        binding=dict(schemaVersion=2,pathSha256=digest(str(lease.path).encode('utf-8')),
                     relativePath=lease.path.relative_to(self.root).as_posix(),fileIdentity=lease.info()['identity'],
                     sha256=digest(lease.read()),bytes=len(content),shareReadOnly=True,denyWrite=True,denyDelete=True,
                     handleHeldForConsumer=True,privateAclProven=bool(proof))
        return lease,binding
    def check(self):
        for lease,protected in self.leases:self.security.prove_private(lease,protected=protected)


class PinnedTree:
    """Locks every discovered approved file + directory, checks exact tree before/after.
    Directory set additions are detected, not claimed to be a filesystem sandbox.
    """
    def __init__(self,security,root,expected):
        self.security=security; self.root=Path(root); self.expected=expected; self.stack=ExitStack()
    def __enter__(self):
        try:
            self.stack.enter_context(self.security.path(self.root,directory=True))
            for current,dirs,files in os.walk(plain_path(self.root),followlinks=False):
                for name in sorted(dirs): self.stack.enter_context(self.security.lock(plain_path(Path(current)/name),directory=True))
                for name in sorted(files): self.stack.enter_context(self.security.lock(plain_path(Path(current)/name)))
            self.check(); return self
        except BaseException: self.stack.close(); raise
    def check(self): require(tree_sha(self.root)==self.expected,'PINNED_FULL_TREE_CHANGED')
    def __exit__(self,*args): return self.stack.__exit__(*args)
