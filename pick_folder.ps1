param(
    [string]$Start = ""
)

$ErrorActionPreference = "Stop"

$cs = @'
using System;
using System.Runtime.InteropServices;

public static class ModernFolderPicker
{
    [ComImport, ClassInterface(ClassInterfaceType.None), Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    private class FileOpenDialog { }

    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog
    {
        [PreserveSig] int Show([In] IntPtr parent);
        void SetFileTypes([In] uint cFileTypes, [In] IntPtr rgFilterSpec);
        void SetFileTypeIndex([In] uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise([In] IntPtr pfde, out uint pdwCookie);
        void Unadvise([In] uint dwCookie);
        void SetOptions([In] uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder([In] IShellItem psi);
        void SetFolder([In] IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([In, MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([In, MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace([In] IShellItem psi, int fdap);
        void SetDefaultExtension([In, MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close([MarshalAs(UnmanagedType.Error)] int hr);
        void SetClientGuid([In] ref Guid guid);
        void ClearClientData();
        void SetFilter([MarshalAs(UnmanagedType.Interface)] IntPtr pFilter);
    }

    [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog
    {
        [PreserveSig] int Show([In] IntPtr parent);
        void SetFileTypes([In] uint cFileTypes, [In] IntPtr rgFilterSpec);
        void SetFileTypeIndex([In] uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise([In] IntPtr pfde, out uint pdwCookie);
        void Unadvise([In] uint dwCookie);
        void SetOptions([In] uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder([In] IShellItem psi);
        void SetFolder([In] IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([In, MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([In, MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace([In] IShellItem psi, int fdap);
        void SetDefaultExtension([In, MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close([MarshalAs(UnmanagedType.Error)] int hr);
        void SetClientGuid([In] ref Guid guid);
        void ClearClientData();
        void SetFilter([MarshalAs(UnmanagedType.Interface)] IntPtr pFilter);
        void GetResults(out IntPtr ppenum);
        void GetSelectedItems(out IntPtr ppsai);
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler([In] IntPtr pbc, [In] ref Guid bhid, [In] ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName([In] uint sigdnName, out IntPtr ppszName);
        void GetAttributes([In] uint sfgaoMask, out uint psfgaoAttribs);
        void Compare([In] IShellItem psi, [In] uint hint, out int piOrder);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(
        [In, MarshalAs(UnmanagedType.LPWStr)] string pszPath,
        [In] IntPtr pbc,
        [In] ref Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("ole32.dll")]
    private static extern void CoTaskMemFree(IntPtr pv);

    private const uint FOS_PICKFOLDERS = 0x00000020;
    private const uint FOS_FORCEFILESYSTEM = 0x00000040;
    private const uint FOS_PATHMUSTEXIST = 0x00000800;
    private const uint SIGDN_FILESYSPATH = 0x80058000;

    public static string Pick(string title, string initial)
    {
        IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialog();
        dialog.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
        if (!string.IsNullOrEmpty(title))
        {
            dialog.SetTitle(title);
        }
        if (!string.IsNullOrEmpty(initial))
        {
            try
            {
                Guid iid = new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe");
                IShellItem startItem;
                SHCreateItemFromParsingName(initial, IntPtr.Zero, ref iid, out startItem);
                if (startItem != null)
                {
                    dialog.SetFolder(startItem);
                }
            }
            catch
            {
            }
        }

        IntPtr owner = GetForegroundWindow();
        int hr = dialog.Show(owner);
        if (hr != 0)
        {
            return string.Empty;
        }

        IShellItem result;
        dialog.GetResult(out result);
        if (result == null)
        {
            return string.Empty;
        }

        IntPtr ptr;
        result.GetDisplayName(SIGDN_FILESYSPATH, out ptr);
        if (ptr == IntPtr.Zero)
        {
            return string.Empty;
        }
        string path = Marshal.PtrToStringUni(ptr);
        CoTaskMemFree(ptr);
        return path ?? string.Empty;
    }
}
'@

Add-Type -TypeDefinition $cs -Language CSharp | Out-Null

$picked = [ModernFolderPicker]::Pick("Select image folder", $Start)
Write-Output $picked
