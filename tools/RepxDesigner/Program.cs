using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using DevExpress.XtraReports.UI;

namespace RepxDesigner
{
    /// <summary>
    /// Opens a .repx file in the DevExpress end-user report designer.
    ///
    /// This is the "edit after export" half of Forma. Forma generates the report
    /// and the model's job ends there: the layout JSON and repxContent are
    /// terminal outputs of one request, never edited afterwards, so they cannot
    /// drift apart. Adjustments -- moving a field, resizing a box, fixing a
    /// caption -- happen here in the real designer, where they cost no tokens and
    /// change nothing you did not touch.
    ///
    /// Three ways in:
    ///
    ///   RepxDesigner.exe                 pick a file (starts in Downloads)
    ///   RepxDesigner.exe report.repx     open that file
    ///   RepxDesigner.exe --serve         listen on 127.0.0.1:7317 for Forma
    ///
    /// --serve is what puts an "Open in designer" button in Forma's workspace:
    /// the page POSTs the XML here and the designer opens on it directly, with no
    /// download and no file dialog. A browser cannot start a program itself, which
    /// is why this side has to exist at all.
    /// </summary>
    internal static class Program
    {
        private const int DefaultPort = 7317;

        /// <summary>
        /// Required on POST /open. Any header outside the CORS safelist forces the
        /// browser to send a preflight, which is what gives OPTIONS a chance to
        /// reject an origin. Without it a random page could fire a no-preflight
        /// POST at this port and pop a designer window on the user's screen.
        /// </summary>
        private const string ClientHeader = "x-forma-client";

        private static Form _pump;

        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (Array.IndexOf(args, "--serve") >= 0)
            {
                RunServer(PortFrom(args));
                return;
            }

            string path = args.Length > 0 ? args[0] : PickFile();
            if (string.IsNullOrEmpty(path))
            {
                return; // cancelled the picker
            }

            OpenDesigner(path);
        }

        // ----------------------------------------------------------------- //
        // Opening
        // ----------------------------------------------------------------- //

        private static void OpenDesigner(string path)
        {
            if (!File.Exists(path))
            {
                MessageBox.Show(
                    "No file at:" + Environment.NewLine + path,
                    "RepxDesigner",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return;
            }

            // Read the version the file claims BEFORE trying to load it. A .repx
            // written by a newer DevExpress than the one installed here is the
            // most likely failure and the raw exception does not always say so.
            string fileVersion = ReadSerializerVersion(path);
            string runtimeVersion = typeof(XtraReport).Assembly.GetName().Version.ToString();

            try
            {
                XtraReport report = XtraReport.FromFile(path, true);

                using (ReportDesignTool tool = new ReportDesignTool(report))
                {
                    // Modal. Saving inside the designer writes back to `path`.
                    tool.ShowDesignerDialog();
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Could not open this report." + Environment.NewLine + Environment.NewLine +
                    "File:              " + Path.GetFileName(path) + Environment.NewLine +
                    "SerializerVersion: " + (fileVersion ?? "not declared") + Environment.NewLine +
                    "Designer version:  " + runtimeVersion + Environment.NewLine + Environment.NewLine +
                    "If those two versions differ, the file was written by a newer " +
                    "DevExpress than the one installed here. Regenerate it targeting " +
                    "the installed version rather than editing the XML by hand." +
                    Environment.NewLine + Environment.NewLine +
                    ex.GetType().Name + ": " + ex.Message,
                    "RepxDesigner",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        private static string PickFile()
        {
            string downloads = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "Downloads");

            using (OpenFileDialog dialog = new OpenFileDialog())
            {
                dialog.Title = "Open a report layout";
                dialog.Filter = "DevExpress report layouts (*.repx)|*.repx|All files (*.*)|*.*";
                dialog.InitialDirectory = Directory.Exists(downloads)
                    ? downloads
                    : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

                return dialog.ShowDialog() == DialogResult.OK ? dialog.FileName : null;
            }
        }

        /// <summary>
        /// Pull SerializerVersion off the root element by text rather than parsing
        /// the document. A file too new to load is also a file we may not be able
        /// to deserialise, and this has to work in exactly that case.
        /// </summary>
        private static string ReadSerializerVersion(string path)
        {
            try
            {
                // The attribute is on the root element, so the first kilobyte is
                // plenty -- these files run to megabytes with images embedded.
                char[] head = new char[1024];
                int read;
                using (StreamReader reader = new StreamReader(path))
                {
                    read = reader.Read(head, 0, head.Length);
                }

                Match match = Regex.Match(new string(head, 0, read), "SerializerVersion=\"([^\"]+)\"");
                return match.Success ? match.Groups[1].Value : null;
            }
            catch (Exception ex)
            {
                Debug.WriteLine("Could not read SerializerVersion: " + ex.Message);
                return null;
            }
        }

        // ----------------------------------------------------------------- //
        // Server mode
        // ----------------------------------------------------------------- //

        private static int PortFrom(string[] args)
        {
            int index = Array.IndexOf(args, "--port");
            int port;
            if (index >= 0 && index + 1 < args.Length && int.TryParse(args[index + 1], out port))
            {
                return port;
            }
            return DefaultPort;
        }

        /// <summary>
        /// A raw TcpListener rather than HttpListener: HttpListener needs a URL
        /// reservation (netsh http add urlacl) or an elevated process, and this is
        /// a personal tool that must run by double-clicking it. The HTTP subset
        /// needed here is a request line, headers, a Content-Length body and a
        /// response -- small enough to hand-roll and avoid the admin prompt.
        /// </summary>
        private static void RunServer(int port)
        {
            TcpListener listener;
            try
            {
                listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Could not listen on 127.0.0.1:" + port + "." + Environment.NewLine +
                    "Another copy of RepxDesigner --serve is probably already running." +
                    Environment.NewLine + Environment.NewLine + ex.Message,
                    "RepxDesigner",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return;
            }

            // The designer must open on the UI thread; the accept loop cannot run
            // there because ShowDesignerDialog is modal. This hidden form is the
            // marshalling point between the two.
            _pump = new Form
            {
                ShowInTaskbar = false,
                WindowState = FormWindowState.Minimized,
                FormBorderStyle = FormBorderStyle.FixedToolWindow,
                Opacity = 0
            };
            _pump.Load += (s, e) => _pump.Hide();

            using (NotifyIcon tray = new NotifyIcon())
            {
                tray.Icon = System.Drawing.SystemIcons.Application;
                tray.Text = "RepxDesigner - listening on 127.0.0.1:" + port;
                tray.Visible = true;

                ContextMenu menu = new ContextMenu();
                menu.MenuItems.Add("Open a .repx...", (s, e) =>
                {
                    string picked = PickFile();
                    if (!string.IsNullOrEmpty(picked)) OpenDesigner(picked);
                });
                menu.MenuItems.Add("-");
                menu.MenuItems.Add("Quit", (s, e) => Application.Exit());
                tray.ContextMenu = menu;

                Thread accepts = new Thread(() => AcceptLoop(listener)) { IsBackground = true };
                accepts.Start();

                Application.Run(_pump);

                tray.Visible = false;
                listener.Stop();
            }
        }

        private static void AcceptLoop(TcpListener listener)
        {
            while (true)
            {
                try
                {
                    using (TcpClient client = listener.AcceptTcpClient())
                    using (NetworkStream stream = client.GetStream())
                    {
                        Handle(stream);
                    }
                }
                catch (SocketException)
                {
                    return; // listener stopped on exit
                }
                catch (Exception ex)
                {
                    Debug.WriteLine("Request failed: " + ex.Message);
                }
            }
        }

        private static void Handle(NetworkStream stream)
        {
            string requestLine;
            Dictionary<string, string> headers;
            string body;

            if (!ReadRequest(stream, out requestLine, out headers, out body))
            {
                return;
            }

            string[] parts = requestLine.Split(' ');
            string method = parts.Length > 0 ? parts[0] : "";
            string target = parts.Length > 1 ? parts[1] : "";

            string origin;
            headers.TryGetValue("origin", out origin);
            string allowed = IsAllowedOrigin(origin) ? origin : null;

            if (method == "OPTIONS")
            {
                // Preflight. An origin we do not recognise gets no
                // Access-Control-Allow-Origin, so the browser blocks the real
                // request before it is ever sent.
                Respond(stream, allowed == null ? 403 : 204, "text/plain", "", allowed);
                return;
            }

            if (method == "GET" && target.StartsWith("/health"))
            {
                // Forma pings this on load and only shows its "Open in designer"
                // button if something answers, the same way isVaultAvailable()
                // gates the key-sync UI. No answer, no button.
                string version = typeof(XtraReport).Assembly.GetName().Version.ToString();
                Respond(stream, 200, "application/json",
                    "{\"app\":\"RepxDesigner\",\"designerVersion\":\"" + version + "\"}", allowed);
                return;
            }

            if (method == "POST" && target.StartsWith("/open"))
            {
                if (!headers.ContainsKey(ClientHeader))
                {
                    Respond(stream, 400, "text/plain", "Missing " + ClientHeader, allowed);
                    return;
                }

                if (string.IsNullOrEmpty(body))
                {
                    Respond(stream, 400, "text/plain", "Empty body", allowed);
                    return;
                }

                string name;
                headers.TryGetValue("x-forma-filename", out name);
                string path = WriteTempCopy(body, name);

                // Answer before opening: ShowDesignerDialog is modal and would
                // otherwise hold the response until the user closes the designer,
                // which reads in the browser as a request that never finishes.
                Respond(stream, 202, "application/json",
                    "{\"opened\":\"" + Path.GetFileName(path).Replace("\"", "") + "\"}", allowed);

                try
                {
                    _pump.BeginInvoke(new Action(() => OpenDesigner(path)));
                }
                catch (Exception ex)
                {
                    Debug.WriteLine("Could not marshal to the UI thread: " + ex.Message);
                }
                return;
            }

            Respond(stream, 404, "text/plain", "Not found", allowed);
        }

        /// <summary>
        /// Loopback only, and only a localhost origin. This is a local tool, so
        /// there is no legitimate caller on the public internet.
        /// </summary>
        private static bool IsAllowedOrigin(string origin)
        {
            if (string.IsNullOrEmpty(origin)) return false;
            return Regex.IsMatch(origin, @"^http://(localhost|127\.0\.0\.1)(:\d+)?$");
        }

        /// <summary>
        /// Never trust a filename off the wire: it decides where we write. Strip
        /// it to a bare name so a caller cannot walk out of the temp folder.
        /// </summary>
        private static string WriteTempCopy(string xml, string suggestedName)
        {
            string safe = "report";
            if (!string.IsNullOrEmpty(suggestedName))
            {
                string candidate = Path.GetFileName(suggestedName);
                candidate = Regex.Replace(candidate, @"[^A-Za-z0-9_\-. ]", "");
                candidate = candidate.Replace(".repx", "").Trim();
                if (candidate.Length > 0) safe = candidate;
            }

            string folder = Path.Combine(Path.GetTempPath(), "Forma");
            Directory.CreateDirectory(folder);

            string path = Path.Combine(folder, safe + ".repx");
            File.WriteAllText(path, xml, new UTF8Encoding(false));
            return path;
        }

        private static bool ReadRequest(
            NetworkStream stream,
            out string requestLine,
            out Dictionary<string, string> headers,
            out string body)
        {
            requestLine = null;
            headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            body = null;

            MemoryStream buffer = new MemoryStream();
            byte[] one = new byte[1];
            int headerEnd = -1;

            // Read byte by byte to the blank line. Slow in principle, irrelevant
            // here -- headers are a few hundred bytes and there is one caller.
            while (buffer.Length < 32 * 1024)
            {
                int read = stream.Read(one, 0, 1);
                if (read == 0) break;
                buffer.WriteByte(one[0]);

                byte[] soFar = buffer.GetBuffer();
                int length = (int)buffer.Length;
                if (length >= 4 &&
                    soFar[length - 4] == '\r' && soFar[length - 3] == '\n' &&
                    soFar[length - 2] == '\r' && soFar[length - 1] == '\n')
                {
                    headerEnd = length;
                    break;
                }
            }

            if (headerEnd < 0) return false;

            string head = Encoding.UTF8.GetString(buffer.GetBuffer(), 0, headerEnd);
            string[] lines = head.Split(new[] { "\r\n" }, StringSplitOptions.RemoveEmptyEntries);
            if (lines.Length == 0) return false;

            requestLine = lines[0];
            for (int i = 1; i < lines.Length; i++)
            {
                int colon = lines[i].IndexOf(':');
                if (colon > 0)
                {
                    headers[lines[i].Substring(0, colon).Trim()] = lines[i].Substring(colon + 1).Trim();
                }
            }

            string lengthValue;
            int contentLength;
            if (headers.TryGetValue("content-length", out lengthValue) &&
                int.TryParse(lengthValue, out contentLength) &&
                contentLength > 0)
            {
                byte[] payload = new byte[contentLength];
                int got = 0;
                while (got < contentLength)
                {
                    int read = stream.Read(payload, got, contentLength - got);
                    if (read == 0) break;
                    got += read;
                }
                body = Encoding.UTF8.GetString(payload, 0, got);
            }

            return true;
        }

        private static void Respond(NetworkStream stream, int status, string contentType, string content, string allowedOrigin)
        {
            byte[] payload = Encoding.UTF8.GetBytes(content ?? "");

            StringBuilder head = new StringBuilder();
            head.Append("HTTP/1.1 ").Append(status).Append(" ").Append(Reason(status)).Append("\r\n");
            head.Append("Content-Type: ").Append(contentType).Append("; charset=utf-8\r\n");
            head.Append("Content-Length: ").Append(payload.Length).Append("\r\n");
            head.Append("Connection: close\r\n");
            if (allowedOrigin != null)
            {
                head.Append("Access-Control-Allow-Origin: ").Append(allowedOrigin).Append("\r\n");
                head.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
                head.Append("Access-Control-Allow-Headers: content-type, ").Append(ClientHeader).Append(", x-forma-filename\r\n");
                head.Append("Access-Control-Max-Age: 600\r\n");
            }
            head.Append("\r\n");

            byte[] headBytes = Encoding.ASCII.GetBytes(head.ToString());
            stream.Write(headBytes, 0, headBytes.Length);
            if (payload.Length > 0) stream.Write(payload, 0, payload.Length);
            stream.Flush();
        }

        private static string Reason(int status)
        {
            switch (status)
            {
                case 200: return "OK";
                case 202: return "Accepted";
                case 204: return "No Content";
                case 400: return "Bad Request";
                case 403: return "Forbidden";
                default: return "Not Found";
            }
        }
    }
}
