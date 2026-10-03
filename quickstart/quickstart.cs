// quickstart.cs — 双击后做两件事:
//   1. 在本 exe 所在目录生成 "Claude Code.bat"(常驻启动按钮:双击 = 在本目录打开终端跑 claude)
//   2. 立即启动 claude(优先 Windows Terminal,没有则回退 cmd)
// 编译:C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe -nologo -target:winexe -out:quickstart.exe quickstart.cs
using System;
using System.Diagnostics;
using System.IO;

class QuickStart
{
    static int Main()
    {
        var dir = AppDomain.CurrentDomain.BaseDirectory;
        try
        {
            // 1) 生成 "Claude Code.bat"
            var bat = Path.Combine(dir, "Claude Code.bat");
            if (!File.Exists(bat))
            {
                File.WriteAllLines(bat, new[]
                {
                    "@echo off",
                    "cd /d \"%~dp0\"",
                    "where wt >nul 2>nul",
                    "if %errorlevel%==0 (",
                    "  start \"\" wt -d \"%~dp0\" cmd /k claude",
                    ") else (",
                    "  start \"Claude Code\" cmd /k claude",
                    ")"
                });
            }

            // 2) 立即启动
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "wt",
                    Arguments = "-d \"" + dir + "\" cmd /k claude",
                    UseShellExecute = true
                });
            }
            catch
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/k claude",
                    WorkingDirectory = dir,
                    UseShellExecute = true
                });
            }
            return 0;
        }
        catch (Exception ex)
        {
            MessageBoxFallback("启动失败: " + ex.Message);
            return 1;
        }
    }

    static void MessageBoxFallback(string msg)
    {
        System.Windows.Forms.MessageBox.Show(msg, "quickstart");
    }
}
