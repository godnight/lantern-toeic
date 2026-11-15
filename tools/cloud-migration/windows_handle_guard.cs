// Windows path guards for the review-only online-backup candidate.
// Deny delete sharing while a path is in use and inspect the opened object,
// rather than following a junction or symbolic link deliberately.
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class LanternMigrationPathGuard
{
    const uint FileReadAttributes = 0x80;
    const uint GenericRead = 0x80000000;
    const uint ReadControl = 0x20000;
    const uint ShareRead = 1;
    const uint ShareWrite = 2;
    const uint OpenExisting = 3;
    const uint BackupSemantics = 0x02000000;
    const uint OpenReparsePoint = 0x00200000;
    const uint AttributeDirectory = 0x10;
    const uint AttributeReparsePoint = 0x400;

    [StructLayout(LayoutKind.Sequential)]
    struct FileTime { public uint Low; public uint High; }

    [StructLayout(LayoutKind.Sequential)]
    struct FileInfo
    {
        public uint Attributes;
        public FileTime CreationTime, LastAccessTime, LastWriteTime;
        public uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security,
        uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfo info);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateDirectoryW(string name, IntPtr security);

    public static void CreateDirectoryExclusive(string path)
    {
        if (!CreateDirectoryW(path, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    public static SafeFileHandle Hold(string path, bool directory)
    {
        SafeFileHandle handle = CreateFileW(path, GenericRead | FileReadAttributes | ReadControl,
            ShareRead | ShareWrite, IntPtr.Zero, OpenExisting, BackupSemantics | OpenReparsePoint, IntPtr.Zero);
        if (handle.IsInvalid) { int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error); }
        try
        {
            FileInfo info;
            if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if ((info.Attributes & AttributeReparsePoint) != 0) throw new InvalidOperationException("reparse point rejected");
            if (((info.Attributes & AttributeDirectory) != 0) != directory) throw new InvalidOperationException("unexpected path type");
            if (!directory && info.NumberOfLinks != 1) throw new InvalidOperationException("hard-linked source rejected");
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }
}
