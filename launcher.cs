// Thin native launcher for Wholesale CRM.
// It only starts `node crm-app.mjs` (which does everything: Matrix boot screen,
// starts the CRM + ankhor in watch/HMR mode, opens the app window). All logic
// lives in crm-app.mjs, so this .exe never needs rebuilding — edit the .mjs and
// it hot-reloads. Compile:  csc /target:exe /out:WholesaleCRM.exe launcher.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

class Launcher {
    static int Main(string[] args) {
        string exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string script = Path.Combine(exeDir, "crm-app.mjs");
        Console.Title = "Wholesale CRM";
        if (!File.Exists(script)) {
            Console.Error.WriteLine("crm-app.mjs was not found next to the exe:\n  " + script);
            Console.Error.WriteLine("Keep WholesaleCRM.exe in the CRM root. Press any key...");
            try { Console.ReadKey(); } catch {}
            return 1;
        }
        try {
            var psi = new ProcessStartInfo {
                FileName = "node",
                Arguments = "\"" + script + "\"",
                WorkingDirectory = exeDir,
                UseShellExecute = false
            };
            foreach (var a in args) psi.Arguments += " \"" + a + "\"";
            var p = Process.Start(psi);
            p.WaitForExit();
            return p.ExitCode;
        } catch (Exception e) {
            Console.Error.WriteLine("Could not start Node.js. Install Node 20+ and make sure `node` is on PATH.");
            Console.Error.WriteLine(e.Message);
            Console.Error.WriteLine("Press any key to exit...");
            try { Console.ReadKey(); } catch {}
            return 1;
        }
    }
}
