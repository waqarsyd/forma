// The SQL Server connections this PC keeps for Forma (2026-11-09, the SQL
// Server programme, Phase 2, item 35). Pure ASCII.
//
// The only place a connection is entered: a page can name one, never create
// one or read its secret. A connection's name is the one a report names, as
// the application's <connectionStrings> knows it, so a report Forma wrote reads
// from the same database here as it will in the application.
using System;
using System.Data.SqlClient;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace RepxDesigner
{
    internal sealed class ConnectionsForm : Form
    {
        private readonly ListBox _list = new ListBox { Dock = DockStyle.Fill, IntegralHeight = false };

        public ConnectionsForm()
        {
            Text = "SQL Server connections for Forma";
            Size = new Size(520, 360);
            StartPosition = FormStartPosition.CenterScreen;
            var note = new Label
            {
                Dock = DockStyle.Top,
                Height = 54,
                Padding = new Padding(8),
                Text = "Name each connection as your application's connectionStrings does, so a report reads the same database here. " +
                       "A login's password is encrypted for this Windows user and never leaves this PC.",
            };
            var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 40, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(6) };
            var close = new Button { Text = "Close", AutoSize = true };
            var remove = new Button { Text = "Remove", AutoSize = true };
            var add = new Button { Text = "Add...", AutoSize = true };
            close.Click += (s, e) => Close();
            remove.Click += (s, e) =>
            {
                var c = _list.SelectedItem as Row;
                if (c != null && MessageBox.Show("Remove the connection \"" + c.Name + "\"?", Text, MessageBoxButtons.YesNo) == DialogResult.Yes)
                {
                    SqlCompanion.Remove(c.Name);
                    Reload();
                }
            };
            add.Click += (s, e) =>
            {
                using (var form = new AddConnectionForm())
                {
                    if (form.ShowDialog(this) == DialogResult.OK) Reload();
                }
            };
            buttons.Controls.AddRange(new Control[] { close, remove, add });
            Controls.Add(_list);
            Controls.Add(buttons);
            Controls.Add(note);
            Reload();
        }

        private sealed class Row
        {
            public string Name;
            public string Label;
            public override string ToString() { return Label; }
        }

        private void Reload()
        {
            _list.Items.Clear();
            foreach (var c in SqlCompanion.Load())
            {
                _list.Items.Add(new Row { Name = c.Name, Label = c.Name + "  -  " + c.Server + " / " + c.Database + (c.Mode == "login" ? "  (SQL Server login)" : "  (Windows)") });
            }
        }
    }

    internal sealed class AddConnectionForm : Form
    {
        private readonly TextBox _name = new TextBox();
        private readonly TextBox _server = new TextBox { Text = "localhost" };
        private readonly TextBox _database = new TextBox();
        private readonly ComboBox _auth = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList };
        private readonly TextBox _login = new TextBox();
        private readonly TextBox _password = new TextBox { UseSystemPasswordChar = true };
        private readonly Label _status = new Label { AutoSize = true, MaximumSize = new Size(420, 0) };

        public AddConnectionForm()
        {
            Text = "Add a SQL Server connection";
            Size = new Size(470, 330);
            StartPosition = FormStartPosition.CenterParent;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            _auth.Items.AddRange(new object[] { "Windows authentication", "SQL Server login" });
            _auth.SelectedIndex = 0;
            _auth.SelectedIndexChanged += (s, e) => { _login.Enabled = _password.Enabled = _auth.SelectedIndex == 1; };
            _login.Enabled = _password.Enabled = false;

            var grid = new TableLayoutPanel { Dock = DockStyle.Top, ColumnCount = 2, AutoSize = true, Padding = new Padding(8) };
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            Action<string, Control> row = (label, control) =>
            {
                control.Dock = DockStyle.Fill;
                grid.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left });
                grid.Controls.Add(control);
            };
            row("Name", _name);
            row("Server", _server);
            row("Database", _database);
            row("Authentication", _auth);
            row("Login", _login);
            row("Password", _password);

            var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 40, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(6) };
            var save = new Button { Text = "Save", AutoSize = true };
            var cancel = new Button { Text = "Cancel", AutoSize = true, DialogResult = DialogResult.Cancel };
            var test = new Button { Text = "Test", AutoSize = true };
            test.Click += (s, e) => _status.Text = Test(Build()) ?? "Connected.";
            save.Click += (s, e) =>
            {
                if (!SqlCompanion.IsName(_name.Text.Trim())) { _status.Text = "A name is letters, digits, _ . or - (as in connectionStrings)."; return; }
                if (_server.Text.Trim().Length == 0 || _database.Text.Trim().Length == 0) { _status.Text = "Give the server and the database."; return; }
                SqlCompanion.Put(Build());
                DialogResult = DialogResult.OK;
                Close();
            };
            buttons.Controls.AddRange(new Control[] { save, cancel, test });
            Controls.Add(_status);
            _status.Dock = DockStyle.Bottom;
            Controls.Add(buttons);
            Controls.Add(grid);
            AcceptButton = save;
            CancelButton = cancel;
        }

        private StoredConnection Build()
        {
            bool login = _auth.SelectedIndex == 1;
            return new StoredConnection
            {
                Name = _name.Text.Trim(),
                Mode = login ? "login" : "windows",
                Server = _server.Text.Trim(),
                Database = _database.Text.Trim(),
                Secret = login ? SqlCompanion.Protect(_login.Text, _password.Text) : "",
            };
        }

        /// <summary>Opens and closes the connection; null when it worked, else why not.</summary>
        private static string Test(StoredConnection c)
        {
            try
            {
                using (var conn = new SqlConnection(SqlCompanion.ConnectionString(c))) conn.Open();
                return null;
            }
            catch (Exception ex)
            {
                return ex.Message.Split('\n').First();
            }
        }
    }
}
