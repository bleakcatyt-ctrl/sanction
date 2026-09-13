using Sanction.Loader.Core;
using Sanction.Loader.Ui;

namespace Sanction.Loader;

internal static class Program
{
    private const string MutexName = "Sanction.Loader.SingleInstance";

    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, MutexName, out bool firstInstance);
        if (!firstInstance)
        {
            MessageBox.Show("Лоадер уже запущен.", "Sanction", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => Report(e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Report(e.ExceptionObject as Exception);

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }

    private static void Report(Exception? ex)
    {
        try
        {
            Directory.CreateDirectory(AppConfig.LogDirectory);
            File.AppendAllText(
                Path.Combine(AppConfig.LogDirectory, "crash.log"),
                $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {ex}{Environment.NewLine}{Environment.NewLine}");
        }
        catch
        {
            // nowhere to write — still show the dialog below
        }

        MessageBox.Show(
            "Лоадер остановлен из-за внутренней ошибки.\nПодробности: %LOCALAPPDATA%\\Sanction\\crash.log",
            "Sanction",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
    }
}
