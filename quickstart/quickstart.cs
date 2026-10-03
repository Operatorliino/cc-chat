// quickstart.cs — 双击后做两件事:
//   1. 在本 exe 所在目录生成/刷新 "Claude Code.bat"(常驻启动按钮:双击 = 在本目录打开终端跑 claude)
//   2. 立即启动 claude(优先 Windows Terminal,没有则回退 cmd)
// 注意:路径尾部反斜杠必须剥掉,否则 wt -d "C:\dir\" 里的 \" 会被解析成转义引号,报 0x8007010b 目录无效
// 编译:C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe -nologo -target:winexe -r:System.Windows.Forms.dll -out:quickstart.exe quickstart.cs
using System;
using System.Diagnostics;
using System.IO;

class QuickStart
{
    static int Main()
    {
        var dir = AppDomain.CurrentDomain.BaseDirectory
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        try
        {
            // 1) 生成/刷新 "Claude Code.bat"
            var bat = Path.Combine(dir, "Claude Code.bat");
            File.WriteAllLines(bat, new[]
            {
                "@echo off",
                "set \"DIR=%~dp0\"",
                "if \"%DIR:~-1%\"==\"\\\" set \"DIR=%DIR:~0,-1%\"",
                "cd /d \"%DIR%\"",
                "where wt >nul 2>nul",
                "if %errorlevel%==0 (",
                "  start \"\" wt -d \"%DIR%\" cmd /k claude",
                ") else (",
                "  start \"Claude Code\" cmd /k claude",
                ")"
            });

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
            System.Windows.Forms.MessageBox.Show("启动失败: " + ex.Message, "quickstart");
            return 1;
        }
    }
}
