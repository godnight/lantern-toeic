"""Synthetic ZIP pairs only; never signs, executes SDK, inspects credentials or devices."""
from pathlib import Path
from unittest.mock import patch
import hashlib
import importlib.util
import struct
import sys
import tempfile
import unittest
import zipfile

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('new_payload_guard',ROOT/'sign_final_phone.py')
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)

def write_aligned(archive,name,body,compress=zipfile.ZIP_STORED,alignment=4096):
    info=zipfile.ZipInfo(name);info.compress_type=compress
    initial=archive.fp.tell()+30+len(name.encode('ascii'))
    padding=(-initial)%alignment
    if padding:
        if padding<4: padding+=alignment
        info.extra=struct.pack('<HH',0xcafe,padding-4)+bytes(padding-4)
    archive.writestr(info,body)

def pair(directory,*,abc_bytes=130576,pages_change=None,extra=None,change=None,remove=(),
         extra_runnable=None,leading_payload=False,abc_compress=zipfile.ZIP_STORED,
         pages_compress=zipfile.ZIP_STORED,abc_alignment=4096):
    unsigned=directory/'unsigned.hap';signed=directory/'signed.hap'
    prior={'ets/modules.abc':b'A'*abc_bytes,'module.json':b'{"synthetic":true}','payload.txt':b'unchanged'}
    if extra_runnable: prior[extra_runnable]=b'runnable fixture'
    with zipfile.ZipFile(unsigned,'w') as archive:
        for name,body in prior.items(): archive.writestr(name,body)
    after=dict(prior)
    if change: after.update(change)
    for name in remove: after.pop(name,None)
    with zipfile.ZipFile(signed,'w') as archive:
        if leading_payload: archive.writestr('module.json',after.pop('module.json'))
        write_aligned(archive,'ets/modules.abc',after.pop('ets/modules.abc'),abc_compress,abc_alignment)
        # The fixture computes expected bits independently from the data offset
        # implied by the next aligned metadata entry.
        current=archive.fp.tell();name='.pages.info'
        maximum=((current+30+len(name)+4095)//4096)*4096
        capacity=((maximum//4096*4+63)//64)*8
        bits=bytearray(capacity)
        start=abc_alignment
        for page in range(start//4096,(start+abc_bytes+4095)//4096):
            bits[page//2] |= 2 << ((page%2)*4)
        metadata=bytes(bits)
        if pages_change: metadata=pages_change(metadata)
        write_aligned(archive,name,metadata,pages_compress)
        for name,body in after.items(): archive.writestr(name,body)
        for name,body in (extra or {}).items(): archive.writestr(name,body)
    return unsigned,signed

class SignedPayloadGuards(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='v045-payload-guard-')
        self.directory=Path(self.temp.name)
        self.run=patch('subprocess.run',side_effect=AssertionError('SIGNING_OR_SDK_FORBIDDEN'))
        self.popen=patch('subprocess.Popen',side_effect=AssertionError('SIGNING_OR_SDK_FORBIDDEN'))
        self.run.start();self.popen.start()
    def tearDown(self):
        self.run.stop();self.popen.stop();self.temp.cleanup()
    def check(self,**kwargs):
        a,b=pair(self.directory,**kwargs)
        return guard.verify_signed_payload(a,b)
    def test_proven_old_layout_reconstructs_exact_approved_bitmap(self):
        result=self.check()
        self.assertEqual(result['signatureMetadataAdded'],['.pages.info'])
        self.assertEqual(result['originalPayloadEntriesUnchanged'],3)
        self.assertEqual(result['pagesInfo']['bytes'],24)
        self.assertEqual(result['pagesInfo']['sha256'],'f9bb96c4ed37cc4271dc672d5804a22a50325f977fd6e8989779f360ce7b622c')
    def test_new_abc_layout_dynamically_derived_without_old_size_or_sha_lock(self):
        result=self.check(abc_bytes=17)
        self.assertEqual(result['pagesInfo']['bytes'],8)
        self.assertEqual(result['pagesInfo']['abcBytes'],17)
        self.assertTrue(result['pagesInfo']['exactDynamicBitmapVerified'])
    def test_wrong_bitmap_rejected(self):
        with self.assertRaisesRegex(guard.GateError,'PAGES_INFO_BITMAP_MISMATCH'):
            self.check(pages_change=lambda b:bytes(len(b)))
    def test_wrong_bitmap_capacity_rejected(self):
        with self.assertRaisesRegex(guard.GateError,'PAGES_INFO_BITMAP_MISMATCH'):
            self.check(pages_change=lambda b:b+b'\0'*8)
    def test_arbitrary_added_member_rejected(self):
        with self.assertRaisesRegex(guard.GateError,'UNEXPECTED_SIGNED_MEMBER_CHANGES'):
            self.check(extra={'unexpected.txt':b'not approved'})
    def test_original_payload_mutation_rejected(self):
        with self.assertRaisesRegex(guard.GateError,'ORIGINAL_HAP_PAYLOAD_CHANGED'):
            self.check(change={'payload.txt':b'mutated'})
    def test_original_payload_removal_rejected(self):
        with self.assertRaisesRegex(guard.GateError,'UNEXPECTED_SIGNED_MEMBER_CHANGES'):
            self.check(remove=('payload.txt',))
    def test_other_runnable_rejected(self):
        with self.assertRaisesRegex(guard.GateError,'PAGES_INFO_OTHER_RUNNABLE_FILE_FORBIDDEN'):
            self.check(extra_runnable='libs/arm64/libother.so')
    def test_nonleading_abc_layout_rejected(self):
        with self.assertRaisesRegex(guard.GateError,'PAGES_INFO_SINGLE_LEADING_ABC_REQUIRED'):
            self.check(leading_payload=True)
    def test_compressed_abc_rejected(self):
        with self.assertRaisesRegex(guard.GateError,'PAGES_INFO_ABC_AND_METADATA_MUST_BE_STORED'):
            self.check(abc_bytes=17,abc_compress=zipfile.ZIP_DEFLATED)
    def test_compressed_metadata_rejected(self):
        with self.assertRaisesRegex(guard.GateError,'PAGES_INFO_ABC_AND_METADATA_MUST_BE_STORED'):
            self.check(pages_compress=zipfile.ZIP_DEFLATED)
    def test_nonbaseline_leading_data_offset_rejected(self):
        with self.assertRaisesRegex(guard.GateError,'PAGES_INFO_PAGE_BOUNDARY_INVALID'):
            self.check(abc_alignment=8192)
    def test_originally_allowed_codesign_metadata_retained_with_pages_guard(self):
        result=self.check(extra={'META-INF/code_sign':b'synthetic signed metadata, not an actual signature'})
        self.assertEqual(result['signatureMetadataAdded'],['.pages.info','META-INF/code_sign'])

if __name__=='__main__': unittest.main(verbosity=2)
