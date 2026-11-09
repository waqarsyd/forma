using System;

namespace RepxDesigner
{
    /// <summary>
    /// Where the program starts (2026-11-09). Program.Run was Main until then; it
    /// moved behind this so that DevExpress is looked for before anything needs
    /// it.
    ///
    /// Nothing in this class may name a DevExpress type, even in a branch that
    /// never runs: .NET compiles this method, and loads every assembly its body
    /// names, before its first line, so a PC without DevExpress would fail here
    /// with no chance to say why. Program.Run, which does name them, is compiled
    /// only when it is called, after DevExpressLocator.Use has said where they are.
    /// </summary>
    internal static class Entry
    {
        [STAThread]
        private static int Main(string[] args)
        {
            DevExpressLocator.Configure(args);
            if (Array.IndexOf(args, "--check") >= 0) return Check.Run(args);

            var usable = DevExpressLocator.Usable(DevExpressLocator.Find());
            if (usable != null) DevExpressLocator.Use(usable);
            Program.Run(args);
            return 0;
        }
    }
}
