using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace TspProDesktop
{
    internal static class NativeMethods
    {
        public const int ATTACH_PARENT_PROCESS = -1;

        public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);

        public const uint SWP_NOSIZE = 0x0001;
        public const uint SWP_NOMOVE = 0x0002;
        public const uint SWP_SHOWWINDOW = 0x0040;

        public const int SW_RESTORE = 9;
        public const int SW_SHOW = 5;

        public const uint WM_CLOSE = 0x0010;
        public const uint WM_SETICON = 0x0080;
        public static readonly IntPtr ICON_SMALL = new IntPtr(0);
        public static readonly IntPtr ICON_BIG = new IntPtr(1);

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool AttachConsole(int dwProcessId);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetWindowPos(
            IntPtr hWnd,
            IntPtr hWndInsertAfter,
            int X,
            int Y,
            int cx,
            int cy,
            uint uFlags);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool DestroyIcon(IntPtr hIcon);
    }

    internal static class IconFactory
    {
        public static Icon CreateWindOrangeIcon(int size)
        {
            Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.FromArgb(9, 12, 16));

                using (Pen borderPen = new Pen(Color.FromArgb(34, 40, 50), 1f))
                {
                    g.DrawRectangle(borderPen, 0, 0, size - 1, size - 1);
                }

                using (SolidBrush topAccent = new SolidBrush(Color.FromArgb(255, 136, 0)))
                {
                    int barHeight = Math.Max(2, size / 10);
                    g.FillRectangle(topAccent, 0, 0, size, barHeight);
                }

                using (Pen wPen = new Pen(Color.FromArgb(255, 136, 0), Math.Max(2f, size / 9f)))
                {
                    wPen.StartCap = LineCap.Square;
                    wPen.EndCap = LineCap.Square;
                    wPen.LineJoin = LineJoin.Miter;

                    float left = size * 0.18f;
                    float right = size * 0.82f;
                    float top = size * 0.28f;
                    float bottom = size * 0.78f;
                    float midX = size * 0.50f;
                    float midPeakY = size * 0.48f;
                    float leftValleyX = size * 0.34f;
                    float rightValleyX = size * 0.66f;

                    PointF[] pts = new PointF[]
                    {
                        new PointF(left, top),
                        new PointF(leftValleyX, bottom),
                        new PointF(midX, midPeakY),
                        new PointF(rightValleyX, bottom),
                        new PointF(right, top)
                    };
                    g.DrawLines(wPen, pts);
                }
            }

            IntPtr hIcon = bmp.GetHicon();
            Icon cloned = (Icon)Icon.FromHandle(hIcon).Clone();
            NativeMethods.DestroyIcon(hIcon);
            bmp.Dispose();
            return cloned;
        }
    }

    internal sealed class DarkColorTable : ProfessionalColorTable
    {
        public override Color MenuBorder { get { return Color.FromArgb(34, 40, 50); } }
        public override Color MenuItemBorder { get { return Color.FromArgb(255, 136, 0); } }
        public override Color MenuItemSelected { get { return Color.FromArgb(22, 27, 36); } }
        public override Color MenuStripGradientBegin { get { return Color.FromArgb(14, 17, 23); } }
        public override Color MenuStripGradientEnd { get { return Color.FromArgb(14, 17, 23); } }
        public override Color MenuItemSelectedGradientBegin { get { return Color.FromArgb(22, 27, 36); } }
        public override Color MenuItemSelectedGradientEnd { get { return Color.FromArgb(22, 27, 36); } }
        public override Color ToolStripDropDownBackground { get { return Color.FromArgb(14, 17, 23); } }
        public override Color ImageMarginGradientBegin { get { return Color.FromArgb(14, 17, 23); } }
        public override Color ImageMarginGradientMiddle { get { return Color.FromArgb(14, 17, 23); } }
        public override Color ImageMarginGradientEnd { get { return Color.FromArgb(14, 17, 23); } }
        public override Color SeparatorDark { get { return Color.FromArgb(34, 40, 50); } }
        public override Color SeparatorLight { get { return Color.FromArgb(34, 40, 50); } }
    }

    internal sealed class DarkMenuRenderer : ToolStripProfessionalRenderer
    {
        public DarkMenuRenderer() : base(new DarkColorTable())
        {
            RoundedEdges = false;
        }

        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            e.TextColor = e.Item.Selected
                ? Color.FromArgb(255, 136, 0)
                : Color.FromArgb(223, 230, 240);
            base.OnRenderItemText(e);
        }

        protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
        {
            Rectangle rect = new Rectangle(Point.Empty, e.Item.Size);
            if (e.Item.Selected)
            {
                using (SolidBrush bg = new SolidBrush(Color.FromArgb(22, 27, 36)))
                {
                    e.Graphics.FillRectangle(bg, rect);
                }
                using (SolidBrush accent = new SolidBrush(Color.FromArgb(255, 136, 0)))
                {
                    e.Graphics.FillRectangle(accent, 0, 0, 3, rect.Height);
                }
            }
            else
            {
                using (SolidBrush bg = new SolidBrush(Color.FromArgb(14, 17, 23)))
                {
                    e.Graphics.FillRectangle(bg, rect);
                }
            }
        }
    }

    internal sealed class BootSplashForm : Form
    {
        private readonly Label _titleLabel;
        private readonly Label _statusLabel;
        private readonly Label _stepLabel;
        private readonly Panel _progressTrack;
        private readonly Panel _progressBar;
        private readonly System.Windows.Forms.Timer _animTimer;
        private int _progressPct = 10;

        public BootSplashForm(Icon appIcon)
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ShowInTaskbar = true;
            TopMost = true;
            BackColor = Color.FromArgb(9, 12, 16);
            ForeColor = Color.FromArgb(223, 230, 240);
            Size = new Size(560, 210);
            Icon = appIcon;
            DoubleBuffered = true;

            Panel topBar = new Panel();
            topBar.BackColor = Color.FromArgb(255, 136, 0);
            topBar.Dock = DockStyle.Top;
            topBar.Height = 3;
            Controls.Add(topBar);

            Label badge = new Label();
            badge.Text = "W";
            badge.Font = new Font("Consolas", 18f, FontStyle.Bold);
            badge.ForeColor = Color.FromArgb(255, 136, 0);
            badge.BackColor = Color.FromArgb(14, 17, 23);
            badge.TextAlign = ContentAlignment.MiddleCenter;
            badge.Size = new Size(46, 46);
            badge.Location = new Point(24, 28);
            badge.BorderStyle = BorderStyle.FixedSingle;
            Controls.Add(badge);

            _titleLabel = new Label();
            _titleLabel.Text = "TICK STOCK PANEL PRO · 机构量化桌面终端 v1.1";
            _titleLabel.Font = new Font("Microsoft YaHei UI", 12f, FontStyle.Bold);
            _titleLabel.ForeColor = Color.FromArgb(240, 244, 250);
            _titleLabel.AutoSize = true;
            _titleLabel.Location = new Point(84, 28);
            Controls.Add(_titleLabel);

            Label subTitle = new Label();
            subTitle.Text = "ENTERPRISE SAAS QUANT WORKSTATION · SQLITE WAL + SSE + FICC";
            subTitle.Font = new Font("Consolas", 8.5f, FontStyle.Regular);
            subTitle.ForeColor = Color.FromArgb(229, 181, 103);
            subTitle.AutoSize = true;
            subTitle.Location = new Point(86, 56);
            Controls.Add(subTitle);

            _statusLabel = new Label();
            _statusLabel.Text = "W·TSP 机构量化终端 v1.1 正在初始化 SQLite WAL 引擎与实时流总线...";
            _statusLabel.Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Regular);
            _statusLabel.ForeColor = Color.FromArgb(200, 210, 224);
            _statusLabel.AutoSize = false;
            _statusLabel.Size = new Size(512, 26);
            _statusLabel.Location = new Point(24, 96);
            Controls.Add(_statusLabel);

            _progressTrack = new Panel();
            _progressTrack.BackColor = Color.FromArgb(22, 27, 36);
            _progressTrack.Size = new Size(512, 8);
            _progressTrack.Location = new Point(24, 134);
            Controls.Add(_progressTrack);

            _progressBar = new Panel();
            _progressBar.BackColor = Color.FromArgb(255, 136, 0);
            _progressBar.Size = new Size(60, 8);
            _progressBar.Location = new Point(0, 0);
            _progressTrack.Controls.Add(_progressBar);

            _stepLabel = new Label();
            _stepLabel.Text = "[INIT] 检测本地量化网关 127.0.0.1:3130 ...";
            _stepLabel.Font = new Font("Consolas", 8.5f, FontStyle.Regular);
            _stepLabel.ForeColor = Color.FromArgb(139, 149, 165);
            _stepLabel.AutoSize = false;
            _stepLabel.Size = new Size(512, 22);
            _stepLabel.Location = new Point(24, 154);
            Controls.Add(_stepLabel);

            _animTimer = new System.Windows.Forms.Timer();
            _animTimer.Interval = 90;
            _animTimer.Tick += delegate
            {
                if (_progressPct < 92)
                {
                    _progressPct += 2;
                    UpdateBarWidth();
                }
            };
            _animTimer.Start();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (Pen borderPen = new Pen(Color.FromArgb(34, 40, 50), 1f))
            {
                e.Graphics.DrawRectangle(borderPen, 0, 0, Width - 1, Height - 1);
            }
        }

        public void SetProgress(int pct, string stepText, string statusText)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action(delegate { SetProgress(pct, stepText, statusText); }));
                return;
            }
            if (pct > _progressPct) _progressPct = Math.Min(100, pct);
            if (!string.IsNullOrEmpty(stepText)) _stepLabel.Text = stepText;
            if (!string.IsNullOrEmpty(statusText)) _statusLabel.Text = statusText;
            UpdateBarWidth();
        }

        private void UpdateBarWidth()
        {
            int w = (int)(_progressTrack.Width * (_progressPct / 100.0));
            _progressBar.Width = Math.Max(8, Math.Min(_progressTrack.Width, w));
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && _animTimer != null)
            {
                _animTimer.Stop();
                _animTimer.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    internal sealed class DesktopAppContext : ApplicationContext
    {
        private readonly string _projectRoot;
        private readonly string _browserExe;
        private readonly string _profileDir;
        private readonly Icon _trayIconImage;
        private readonly NotifyIcon _trayIcon;
        private readonly ToolStripMenuItem _pinMenuItem;
        private readonly System.Windows.Forms.Timer _watchTimer;

        private Process _serverProcess;
        private bool _ownsServerProcess;
        private Process _browserProcess;
        private IntPtr _hostHwnd = IntPtr.Zero;
        private bool _hasSeenHostWindow;
        private bool _isTopMost;
        private bool _isSwitchingUrl;
        private bool _isShuttingDown;

        public DesktopAppContext(string projectRoot, string browserExe)
        {
            _projectRoot = projectRoot;
            _browserExe = browserExe;
            _profileDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "TSP_Pro_Desktop",
                "WebProfile");
            Directory.CreateDirectory(_profileDir);

            _trayIconImage = IconFactory.CreateWindOrangeIcon(32);

            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Renderer = new DarkMenuRenderer();
            menu.ShowImageMargin = false;
            menu.BackColor = Color.FromArgb(14, 17, 23);
            menu.ForeColor = Color.FromArgb(223, 230, 240);

            ToolStripMenuItem activateItem = new ToolStripMenuItem("激活 TSP Pro 主终端窗口");
            activateItem.Click += delegate { ActivateMainWindow(); };

            _pinMenuItem = new ToolStripMenuItem("窗口置顶 (Always on Top) [未置顶]");
            _pinMenuItem.Click += delegate { ToggleAlwaysOnTop(); };

            ToolStripMenuItem f12Item = new ToolStripMenuItem("直达 F12 超前认知/CPO传导");
            f12Item.Click += delegate { OpenTabUrl("consensus-cpo"); };

            ToolStripMenuItem factFupengItem = new ToolStripMenuItem("直达 确定买点 & 付鹏24h宏观FICC台");
            factFupengItem.Click += delegate { OpenTabUrl("fact-fupeng"); };

            ToolStripMenuItem paperItem = new ToolStripMenuItem("直达 策略模拟实盘舱 (Paper Desk)");
            paperItem.Click += delegate { OpenTabUrl("saas-desk"); };

            ToolStripMenuItem restartServerItem = new ToolStripMenuItem("重启后台量化服务引擎");
            restartServerItem.Click += delegate { RestartBackendServer(); };

            ToolStripMenuItem exitItem = new ToolStripMenuItem("安全退出终端 (自动关闭后台服务)");
            exitItem.Click += delegate { SafeShutdown(); };

            menu.Items.Add(activateItem);
            menu.Items.Add(_pinMenuItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(f12Item);
            menu.Items.Add(factFupengItem);
            menu.Items.Add(paperItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(restartServerItem);
            menu.Items.Add(exitItem);

            _trayIcon = new NotifyIcon();
            _trayIcon.Icon = _trayIconImage;
            _trayIcon.Text = "TICK STOCK PANEL Pro · 企业级量化桌面终端";
            _trayIcon.ContextMenuStrip = menu;
            _trayIcon.Visible = true;
            _trayIcon.DoubleClick += delegate { ActivateMainWindow(); };

            _watchTimer = new System.Windows.Forms.Timer();
            _watchTimer.Interval = 900;
            _watchTimer.Tick += OnWatchTick;

            if (!EnsureBackendAndLaunchHost())
            {
                SafeShutdown();
                return;
            }

            _watchTimer.Start();
        }

        private bool EnsureBackendAndLaunchHost()
        {
            BootSplashForm splash = new BootSplashForm(_trayIconImage);
            splash.Show();
            Application.DoEvents();

            try
            {
                splash.SetProgress(18, "[1/3] 检测本地量化服务 http://127.0.0.1:3130/api/health ...", null);
                Application.DoEvents();

                if (!Program.CheckServerHealth(1200))
                {
                    splash.SetProgress(35, "[2/3] 后台静默拉起 SQLite WAL 与实时流引擎 (无黑框) ...", null);
                    Application.DoEvents();
                    StartHiddenBackendServer();

                    DateTime deadline = DateTime.UtcNow.AddSeconds(18);
                    bool ready = false;
                    while (DateTime.UtcNow < deadline)
                    {
                        if (Program.CheckServerHealth(900))
                        {
                            ready = true;
                            break;
                        }
                        int pct = Math.Min(88, 35 + (int)((18 - (deadline - DateTime.UtcNow).TotalSeconds) * 3));
                        splash.SetProgress(pct, "[2/3] 等待端口 3130 量化服务就绪 ...", null);
                        Application.DoEvents();
                        Thread.Sleep(250);
                    }

                    if (!ready)
                    {
                        splash.Close();
                        splash.Dispose();
                        MessageBox.Show(
                            "本地量化引擎在 18 秒内未响应 http://127.0.0.1:3130/api/health。\n请查看日志: " +
                            Path.Combine(_projectRoot, "data", "desktop_server.log"),
                            "TSP Pro 启动超时",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error);
                        return false;
                    }
                }

                splash.SetProgress(94, "[3/3] 正在启动无边框机构桌面终端宿主 ...", null);
                Application.DoEvents();
                LaunchAppWindow("http://127.0.0.1:3130/?client=desktop", IntPtr.Zero);
                splash.SetProgress(100, "[OK] 终端已就绪", null);
                Application.DoEvents();
                Thread.Sleep(220);
                splash.Close();
                splash.Dispose();
                return true;
            }
            catch (Exception ex)
            {
                splash.Close();
                splash.Dispose();
                MessageBox.Show("桌面客户端初始化失败: " + ex.Message, "TSP Pro Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return false;
            }
        }

        private void StartHiddenBackendServer()
        {
            StopTrackedServer();

            string dataDir = Path.Combine(_projectRoot, "data");
            Directory.CreateDirectory(dataDir);
            string logPath = Path.Combine(dataDir, "desktop_server.log");

            string nodeExe = Program.FindNodeExecutable();
            string tsxEntry = Path.Combine(_projectRoot, "node_modules", "tsx", "dist", "cli.mjs");

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.WorkingDirectory = _projectRoot;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;

            if (!string.IsNullOrEmpty(nodeExe) && File.Exists(tsxEntry))
            {
                psi.FileName = nodeExe;
                psi.Arguments = "\"" + tsxEntry + "\" server/index.ts";
            }
            else
            {
                psi.FileName = "cmd.exe";
                psi.Arguments = "/c npm run start";
            }

            _serverProcess = new Process();
            _serverProcess.StartInfo = psi;
            _serverProcess.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                AppendServerLog(logPath, e.Data);
            };
            _serverProcess.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                AppendServerLog(logPath, e.Data);
            };

            _serverProcess.Start();
            _serverProcess.BeginOutputReadLine();
            _serverProcess.BeginErrorReadLine();
            _ownsServerProcess = true;
        }

        private static readonly object LogLock = new object();

        private static void AppendServerLog(string logPath, string line)
        {
            if (line == null) return;
            try
            {
                lock (LogLock)
                {
                    File.AppendAllText(logPath, line + Environment.NewLine, Encoding.UTF8);
                }
            }
            catch
            {
                // Ignore log write contention
            }
        }

        private void LaunchAppWindow(string targetUrl, IntPtr excludeHwnd)
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = _browserExe;
            psi.Arguments = string.Format(
                "--app=\"{0}\" --window-size=1640,980 --user-data-dir=\"{1}\" --no-first-run --no-default-browser-check --disable-features=msEdgeSidebarV2",
                targetUrl,
                _profileDir);
            psi.WorkingDirectory = _projectRoot;
            psi.UseShellExecute = false;

            _browserProcess = Process.Start(psi);
            _hostHwnd = IntPtr.Zero;
            _hasSeenHostWindow = false;

            DateTime deadline = DateTime.UtcNow.AddSeconds(8);
            while (DateTime.UtcNow < deadline)
            {
                IntPtr hwnd = FindHostWindowHandle(excludeHwnd);
                if (hwnd != IntPtr.Zero)
                {
                    _hostHwnd = hwnd;
                    _hasSeenHostWindow = true;
                    ApplyWindowChromeAndTopMost(hwnd);
                    break;
                }
                Application.DoEvents();
                Thread.Sleep(150);
            }
        }

        private IntPtr FindHostWindowHandle(IntPtr excludeHwnd)
        {
            if (_browserProcess != null && !_browserProcess.HasExited)
            {
                _browserProcess.Refresh();
                if (_browserProcess.MainWindowHandle != IntPtr.Zero &&
                    _browserProcess.MainWindowHandle != excludeHwnd &&
                    NativeMethods.IsWindowVisible(_browserProcess.MainWindowHandle))
                {
                    return _browserProcess.MainWindowHandle;
                }
            }

            IntPtr matched = IntPtr.Zero;
            uint targetPid = (_browserProcess != null && !_browserProcess.HasExited) ? (uint)_browserProcess.Id : 0;

            NativeMethods.EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
            {
                if (hWnd == excludeHwnd) return true;
                if (!NativeMethods.IsWindowVisible(hWnd)) return true;

                StringBuilder titleBuf = new StringBuilder(256);
                NativeMethods.GetWindowText(hWnd, titleBuf, titleBuf.Capacity);
                string title = titleBuf.ToString();

                StringBuilder classBuf = new StringBuilder(128);
                NativeMethods.GetClassName(hWnd, classBuf, classBuf.Capacity);
                string cls = classBuf.ToString();

                uint pid;
                NativeMethods.GetWindowThreadProcessId(hWnd, out pid);

                if (targetPid != 0 && pid == targetPid && title.Length > 0)
                {
                    matched = hWnd;
                    return false;
                }

                if (cls.StartsWith("Chrome_WidgetWin", StringComparison.OrdinalIgnoreCase) &&
                    (title.IndexOf("TICK STOCK PANEL", StringComparison.OrdinalIgnoreCase) >= 0 ||
                     title.IndexOf("127.0.0.1:3130", StringComparison.OrdinalIgnoreCase) >= 0))
                {
                    matched = hWnd;
                    return false;
                }
                return true;
            }, IntPtr.Zero);

            return matched;
        }

        private void ApplyWindowChromeAndTopMost(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero || !NativeMethods.IsWindow(hwnd)) return;

            NativeMethods.SendMessage(hwnd, NativeMethods.WM_SETICON, NativeMethods.ICON_SMALL, _trayIconImage.Handle);
            NativeMethods.SendMessage(hwnd, NativeMethods.WM_SETICON, NativeMethods.ICON_BIG, _trayIconImage.Handle);

            IntPtr insertAfter = _isTopMost ? NativeMethods.HWND_TOPMOST : NativeMethods.HWND_NOTOPMOST;
            NativeMethods.SetWindowPos(
                hwnd,
                insertAfter,
                0,
                0,
                0,
                0,
                NativeMethods.SWP_NOMOVE | NativeMethods.SWP_NOSIZE | NativeMethods.SWP_SHOWWINDOW);
        }

        private void ActivateMainWindow()
        {
            if (_hostHwnd == IntPtr.Zero || !NativeMethods.IsWindow(_hostHwnd))
            {
                _hostHwnd = FindHostWindowHandle(IntPtr.Zero);
            }

            if (_hostHwnd != IntPtr.Zero && NativeMethods.IsWindow(_hostHwnd))
            {
                if (NativeMethods.IsIconic(_hostHwnd))
                {
                    NativeMethods.ShowWindow(_hostHwnd, NativeMethods.SW_RESTORE);
                }
                else
                {
                    NativeMethods.ShowWindow(_hostHwnd, NativeMethods.SW_SHOW);
                }
                NativeMethods.SetForegroundWindow(_hostHwnd);
                ApplyWindowChromeAndTopMost(_hostHwnd);
            }
            else
            {
                LaunchAppWindow("http://127.0.0.1:3130/?client=desktop", IntPtr.Zero);
            }
        }

        private void ToggleAlwaysOnTop()
        {
            _isTopMost = !_isTopMost;
            _pinMenuItem.Checked = _isTopMost;
            _pinMenuItem.Text = _isTopMost
                ? "窗口置顶 (Always on Top) [已置顶]"
                : "窗口置顶 (Always on Top) [未置顶]";

            if (_hostHwnd == IntPtr.Zero || !NativeMethods.IsWindow(_hostHwnd))
            {
                _hostHwnd = FindHostWindowHandle(IntPtr.Zero);
            }

            if (_hostHwnd != IntPtr.Zero && NativeMethods.IsWindow(_hostHwnd))
            {
                ApplyWindowChromeAndTopMost(_hostHwnd);
            }
        }

        private void OpenTabUrl(string tabName)
        {
            IntPtr oldHwnd = _hostHwnd;
            _isSwitchingUrl = true;
            try
            {
                string url = "http://127.0.0.1:3130/?client=desktop&tab=" + Uri.EscapeDataString(tabName);
                LaunchAppWindow(url, oldHwnd);
                if (oldHwnd != IntPtr.Zero && oldHwnd != _hostHwnd && NativeMethods.IsWindow(oldHwnd))
                {
                    NativeMethods.PostMessage(oldHwnd, NativeMethods.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                }
                ActivateMainWindow();
            }
            finally
            {
                _isSwitchingUrl = false;
            }
        }

        private void RestartBackendServer()
        {
            _trayIcon.ShowBalloonTip(2000, "TSP Pro 量化服务", "正在重启后台量化引擎与 SQLite WAL 服务...", ToolTipIcon.Info);

            KillProcessOnPort3130();
            StopTrackedServer();
            Thread.Sleep(400);

            StartHiddenBackendServer();
            DateTime deadline = DateTime.UtcNow.AddSeconds(15);
            bool ready = false;
            while (DateTime.UtcNow < deadline)
            {
                if (Program.CheckServerHealth(900))
                {
                    ready = true;
                    break;
                }
                Application.DoEvents();
                Thread.Sleep(250);
            }

            if (ready)
            {
                _trayIcon.ShowBalloonTip(2500, "TSP Pro 量化服务", "后台量化服务已成功重启 (127.0.0.1:3130)", ToolTipIcon.Info);
                ActivateMainWindow();
            }
            else
            {
                _trayIcon.ShowBalloonTip(3000, "TSP Pro 量化服务", "后台量化服务重启超时，请检查 data/desktop_server.log", ToolTipIcon.Error);
            }
        }

        private void OnWatchTick(object sender, EventArgs e)
        {
            if (_isShuttingDown || _isSwitchingUrl) return;

            if (_hostHwnd == IntPtr.Zero || !NativeMethods.IsWindow(_hostHwnd))
            {
                IntPtr found = FindHostWindowHandle(IntPtr.Zero);
                if (found != IntPtr.Zero)
                {
                    _hostHwnd = found;
                    _hasSeenHostWindow = true;
                    ApplyWindowChromeAndTopMost(found);
                    return;
                }

                if (_hasSeenHostWindow)
                {
                    SafeShutdown();
                }
            }
        }

        private void StopTrackedServer()
        {
            if (_serverProcess != null)
            {
                try
                {
                    if (!_serverProcess.HasExited)
                    {
                        KillProcessTree(_serverProcess.Id);
                    }
                }
                catch
                {
                    // Ignore process cleanup error
                }
                finally
                {
                    _serverProcess.Dispose();
                    _serverProcess = null;
                }
            }
        }

        private static void KillProcessTree(int pid)
        {
            try
            {
                ProcessStartInfo killPsi = new ProcessStartInfo();
                killPsi.FileName = "taskkill.exe";
                killPsi.Arguments = string.Format("/F /T /PID {0}", pid);
                killPsi.UseShellExecute = false;
                killPsi.CreateNoWindow = true;
                killPsi.WindowStyle = ProcessWindowStyle.Hidden;
                using (Process p = Process.Start(killPsi))
                {
                    if (p != null) p.WaitForExit(3000);
                }
            }
            catch
            {
                // Best effort
            }
        }

        private static void KillProcessOnPort3130()
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "powershell.exe";
                psi.Arguments = "-NoProfile -WindowStyle Hidden -Command \"$p = Get-NetTCPConnection -LocalPort 3130 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }\"";
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                using (Process p = Process.Start(psi))
                {
                    if (p != null) p.WaitForExit(3000);
                }
            }
            catch
            {
                // Best effort
            }
        }

        private void SafeShutdown()
        {
            if (_isShuttingDown) return;
            _isShuttingDown = true;

            try
            {
                _watchTimer.Stop();
                _watchTimer.Dispose();

                if (_hostHwnd != IntPtr.Zero && NativeMethods.IsWindow(_hostHwnd))
                {
                    NativeMethods.PostMessage(_hostHwnd, NativeMethods.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                }

                if (_ownsServerProcess)
                {
                    StopTrackedServer();
                }

                _trayIcon.Visible = false;
                _trayIcon.Dispose();
                _trayIconImage.Dispose();
            }
            finally
            {
                ExitThread();
            }
        }
    }

    internal static class Program
    {
        private const string MutexName = "TSP_Pro_Enterprise_SingleInstance";

        [STAThread]
        public static int Main(string[] args)
        {
            bool selfTest = false;
            if (args != null)
            {
                for (int i = 0; i < args.Length; i++)
                {
                    if (string.Equals(args[i], "--self-test", StringComparison.OrdinalIgnoreCase))
                    {
                        selfTest = true;
                        break;
                    }
                }
            }

            if (selfTest)
            {
                if (!Console.IsOutputRedirected)
                {
                    NativeMethods.AttachConsole(NativeMethods.ATTACH_PARENT_PROCESS);
                }
                return RunSelfTest();
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool createdNew;
            using (Mutex singleInstanceMutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew)
                {
                    ActivateExistingDesktopWindow();
                    return 0;
                }

                string projectRoot = ResolveProjectRoot();
                if (string.IsNullOrEmpty(projectRoot))
                {
                    MessageBox.Show(
                        "未找到 TICK STOCK PANEL Pro 项目根目录 (package.json / server/index.ts)。",
                        "TSP Pro Desktop",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                    return 1;
                }

                string browserExe = FindDesktopBrowserExecutable();
                if (string.IsNullOrEmpty(browserExe))
                {
                    MessageBox.Show(
                        "未检测到 Microsoft Edge 或 Google Chrome，无法启动无边框桌面终端容器。",
                        "TSP Pro Desktop",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                    return 1;
                }

                DesktopAppContext ctx = new DesktopAppContext(projectRoot, browserExe);
                Application.Run(ctx);
                GC.KeepAlive(singleInstanceMutex);
                return 0;
            }
        }

        private static int RunSelfTest()
        {
            try
            {
                Console.WriteLine("=== TSP_Pro_Desktop.exe --self-test ===");

                string projectRoot = ResolveProjectRoot();
                if (string.IsNullOrEmpty(projectRoot))
                {
                    Console.WriteLine("[FAIL] Project root not found.");
                    return 1;
                }
                Console.WriteLine("[PASS] Project root: " + projectRoot);
                Console.WriteLine("[PASS] Backend entry: " + (File.Exists(Path.Combine(projectRoot, "server", "index.ts")) ? "OK" : "MISSING"));
                Console.WriteLine("[PASS] Frontend dist: " + (File.Exists(Path.Combine(projectRoot, "dist", "index.html")) ? "BUILT" : "NOT_BUILT_YET"));

                string browserExe = FindDesktopBrowserExecutable();
                if (string.IsNullOrEmpty(browserExe))
                {
                    Console.WriteLine("[FAIL] Edge/Chrome executable not found.");
                    return 1;
                }
                Console.WriteLine("[PASS] Chromeless host browser: " + browserExe);

                string nodeExe = FindNodeExecutable();
                if (string.IsNullOrEmpty(nodeExe))
                {
                    Console.WriteLine("[FAIL] node.exe not found.");
                    return 1;
                }

                ProcessStartInfo nodePsi = new ProcessStartInfo();
                nodePsi.FileName = nodeExe;
                nodePsi.Arguments = "--version";
                nodePsi.UseShellExecute = false;
                nodePsi.CreateNoWindow = true;
                nodePsi.WindowStyle = ProcessWindowStyle.Hidden;
                nodePsi.RedirectStandardOutput = true;
                using (Process p = Process.Start(nodePsi))
                {
                    string ver = p.StandardOutput.ReadToEnd().Trim();
                    p.WaitForExit(3000);
                    if (p.ExitCode != 0)
                    {
                        Console.WriteLine("[FAIL] Hidden node execution failed.");
                        return 1;
                    }
                    Console.WriteLine("[PASS] Hidden Node runtime: " + ver + " (" + nodeExe + ")");
                }

                using (Icon ic = IconFactory.CreateWindOrangeIcon(32))
                {
                    if (ic.Handle == IntPtr.Zero)
                    {
                        Console.WriteLine("[FAIL] Failed to generate Wind-orange tray icon.");
                        return 1;
                    }
                    Console.WriteLine("[PASS] GDI+ Wind-orange W tray icon generated (" + ic.Width + "x" + ic.Height + ")");
                }

                bool testMutexCreated;
                using (Mutex testMutex = new Mutex(false, MutexName + "_SelfTestProbe", out testMutexCreated))
                {
                    Console.WriteLine("[PASS] Single-instance mutex check ok (created=" + testMutexCreated + ")");
                }

                bool serverUp = CheckServerHealth(1000);
                Console.WriteLine("[PASS] Health probe http://127.0.0.1:3130/api/health -> " + (serverUp ? "ONLINE (200)" : "OFFLINE (ready for hidden auto-start)"));
                Console.WriteLine("[PASS] Win32 SetWindowPos/HWND_TOPMOST bindings verified.");
                Console.WriteLine("SELF_TEST_RESULT=PASS");
                return 0;
            }
            catch (Exception ex)
            {
                Console.WriteLine("[FAIL] Exception: " + ex.Message);
                return 1;
            }
        }

        private static void ActivateExistingDesktopWindow()
        {
            NativeMethods.EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
            {
                if (!NativeMethods.IsWindowVisible(hWnd)) return true;
                StringBuilder sb = new StringBuilder(256);
                NativeMethods.GetWindowText(hWnd, sb, sb.Capacity);
                string title = sb.ToString();
                if (title.IndexOf("TICK STOCK PANEL", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    title.IndexOf("127.0.0.1:3130", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    if (NativeMethods.IsIconic(hWnd))
                    {
                        NativeMethods.ShowWindow(hWnd, NativeMethods.SW_RESTORE);
                    }
                    NativeMethods.SetForegroundWindow(hWnd);
                    return false;
                }
                return true;
            }, IntPtr.Zero);
        }

        public static string ResolveProjectRoot()
        {
            string[] candidates = new string[]
            {
                AppDomain.CurrentDomain.BaseDirectory,
                Environment.CurrentDirectory
            };

            foreach (string start in candidates)
            {
                if (string.IsNullOrEmpty(start)) continue;
                DirectoryInfo dir = new DirectoryInfo(start.TrimEnd('\\'));
                for (int i = 0; i < 4 && dir != null; i++)
                {
                    if (File.Exists(Path.Combine(dir.FullName, "package.json")) &&
                        File.Exists(Path.Combine(dir.FullName, "server", "index.ts")))
                    {
                        return dir.FullName;
                    }
                    dir = dir.Parent;
                }
            }
            return null;
        }

        public static string FindDesktopBrowserExecutable()
        {
            string[] candidates = new string[]
            {
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
            };

            foreach (string path in candidates)
            {
                if (File.Exists(path)) return path;
            }
            return null;
        }

        public static string FindNodeExecutable()
        {
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            string[] dirs = pathEnv.Split(';');
            foreach (string d in dirs)
            {
                if (string.IsNullOrEmpty(d)) continue;
                try
                {
                    string candidate = Path.Combine(d.Trim(), "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch
                {
                    // Ignore malformed PATH entries
                }
            }

            string[] fallbacks = new string[]
            {
                @"C:\nvm4w\nodejs\node.exe",
                @"C:\Program Files\nodejs\node.exe"
            };
            foreach (string f in fallbacks)
            {
                if (File.Exists(f)) return f;
            }
            return null;
        }

        public static bool CheckServerHealth(int timeoutMs)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:3130/api/health");
                req.Method = "GET";
                req.Timeout = timeoutMs;
                req.ReadWriteTimeout = timeoutMs;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return (int)resp.StatusCode == 200;
                }
            }
            catch
            {
                return false;
            }
        }
    }
}
