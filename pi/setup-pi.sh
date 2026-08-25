#!/usr/bin/env bash
#
# St. Elias Coffee Hour Kiosk — Raspberry Pi setup
# ---------------------------------------------------------------------------
# Run this once on the Pi that drives the TV in the hall. After that the Pi
# looks after itself: it boots straight into the announcements, and it picks up
# new announcements from the Google Sheet on its own.
#
#   chmod +x setup-pi.sh
#   ./setup-pi.sh https://yourname.github.io/stelias-kiosk/
#
# Safe to run again later if you need to change the address.
#
set -euo pipefail

# --------------------------------------------------------------------------
# Where the kiosk page lives
# --------------------------------------------------------------------------

KIOSK_URL="${1:-}"

if [[ -z "$KIOSK_URL" ]]; then
  echo
  read -r -p "Address of the kiosk page (e.g. https://yourname.github.io/stelias-kiosk/): " KIOSK_URL
fi

if [[ ! "$KIOSK_URL" =~ ^https?:// ]]; then
  echo "That doesn't look like a web address. It needs to start with http:// or https://" >&2
  exit 1
fi

echo
echo "==> Kiosk address: $KIOSK_URL"

# --------------------------------------------------------------------------
# Which desktop is this Pi running?
#
# This matters more than it sounds. Raspberry Pi OS Bookworm switched the
# default desktop from X11 to Wayland (labwc). The old X11 recipes that fill
# the internet -- editing ~/.config/lxsession/... and calling xset -- do
# absolutely nothing on Wayland, and they fail silently, which is why so many
# Pi kiosk guides "work" for everyone except the person following them.
# --------------------------------------------------------------------------

detect_session() {
  if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
    if   [[ -d "$HOME/.config/labwc"  ]] || command -v labwc  >/dev/null 2>&1; then echo "labwc"
    elif [[ -f "$HOME/.config/wayfire.ini" ]] || command -v wayfire >/dev/null 2>&1; then echo "wayfire"
    else echo "wayland-other"; fi
  elif [[ "${XDG_SESSION_TYPE:-}" == "x11" ]]; then
    echo "x11"
  elif command -v labwc >/dev/null 2>&1; then
    echo "labwc"
  elif [[ -d "$HOME/.config/lxsession" ]]; then
    echo "x11"
  else
    echo "unknown"
  fi
}

SESSION="$(detect_session)"
echo "==> Desktop session detected: $SESSION"

# --------------------------------------------------------------------------
# Packages
# --------------------------------------------------------------------------

echo
echo "==> Installing what we need (this can take a few minutes)"
sudo apt-get update -qq

PACKAGES=(chromium-browser)
# Bookworm renamed the package. Install whichever one this Pi actually has.
if ! apt-cache show chromium-browser >/dev/null 2>&1; then
  PACKAGES=(chromium)
fi

# unclutter hides the mouse pointer. It is X11-only; on Wayland the pointer
# hides itself when the mouse stops moving, so we skip it there.
if [[ "$SESSION" == "x11" ]]; then
  PACKAGES+=(unclutter)
fi

sudo apt-get install -y "${PACKAGES[@]}"

CHROMIUM_BIN="$(command -v chromium-browser || command -v chromium)"
echo "==> Using browser: $CHROMIUM_BIN"

# --------------------------------------------------------------------------
# Stop the screen going to sleep
#
# raspi-config knows how to do this correctly for whichever desktop is running,
# which saves us guessing between xset, wlr-randr and compositor settings.
# --------------------------------------------------------------------------

echo
echo "==> Turning off screen blanking"
if command -v raspi-config >/dev/null 2>&1; then
  sudo raspi-config nonint do_blanking 1 || echo "    (raspi-config couldn't set this; see the README)"
else
  echo "    (raspi-config not found -- skipping)"
fi

# --------------------------------------------------------------------------
# The launcher
# --------------------------------------------------------------------------

LAUNCHER="$HOME/kiosk.sh"
echo "==> Writing launcher: $LAUNCHER"

cat > "$LAUNCHER" <<LAUNCHER_EOF
#!/usr/bin/env bash
# Starts the announcements screen. Written by setup-pi.sh -- edit the address
# below, or just run setup-pi.sh again with the new one.

KIOSK_URL="$KIOSK_URL"
CHROMIUM_BIN="$CHROMIUM_BIN"

# Give the network a moment. On a cold boot the Pi is often ready before the
# wifi is, and Chromium would otherwise open straight onto an error page.
for i in \$(seq 1 30); do
  if ping -c1 -W1 8.8.8.8 >/dev/null 2>&1; then break; fi
  sleep 2
done

# Chromium sulks about an "unclean shutdown" after a power cut and shows a
# restore bar across the top of the screen. Clearing these flags prevents that.
PROFILE="\$HOME/.config/chromium/Default/Preferences"
if [[ -f "\$PROFILE" ]]; then
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/g; s/"exited_cleanly":false/"exited_cleanly":true/g' "\$PROFILE" || true
fi

if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0.5 -root &
fi

# --password-store=basic: without it, Chromium tries to unlock the OS
# keyring on launch, and on a Pi with no keyring set up yet that opens a
# blocking "choose a password" dialog that sits on top of the kiosk forever.
exec "\$CHROMIUM_BIN" \\
  --password-store=basic \\
  --kiosk \\
  --noerrdialogs \\
  --disable-infobars \\
  --disable-session-crashed-bubble \\
  --disable-features=Translate,TranslateUI \\
  --no-first-run \\
  --check-for-update-interval=31536000 \\
  --autoplay-policy=no-user-gesture-required \\
  "\$KIOSK_URL"
LAUNCHER_EOF

chmod +x "$LAUNCHER"

# --------------------------------------------------------------------------
# Start it on boot -- the right way for this desktop
# --------------------------------------------------------------------------

echo "==> Setting it to start on boot"

case "$SESSION" in
  labwc)
    mkdir -p "$HOME/.config/labwc"
    AUTOSTART="$HOME/.config/labwc/autostart"
    touch "$AUTOSTART"
    grep -v 'kiosk.sh' "$AUTOSTART" > "$AUTOSTART.tmp" 2>/dev/null || true
    mv "$AUTOSTART.tmp" "$AUTOSTART" 2>/dev/null || true
    echo "$LAUNCHER &" >> "$AUTOSTART"
    echo "    -> $AUTOSTART"
    ;;

  wayfire)
    WAYFIRE="$HOME/.config/wayfire.ini"
    touch "$WAYFIRE"
    if ! grep -q '^\[autostart\]' "$WAYFIRE"; then
      printf '\n[autostart]\n' >> "$WAYFIRE"
    fi
    if ! grep -q '^kiosk *=' "$WAYFIRE"; then
      sed -i "/^\[autostart\]/a kiosk = $LAUNCHER" "$WAYFIRE"
    else
      sed -i "s|^kiosk *=.*|kiosk = $LAUNCHER|" "$WAYFIRE"
    fi
    echo "    -> $WAYFIRE"
    ;;

  x11)
    AUTOSTART_DIR="$HOME/.config/lxsession/LXDE-pi"
    mkdir -p "$AUTOSTART_DIR"
    AUTOSTART="$AUTOSTART_DIR/autostart"
    touch "$AUTOSTART"
    grep -v 'kiosk.sh' "$AUTOSTART" > "$AUTOSTART.tmp" 2>/dev/null || true
    mv "$AUTOSTART.tmp" "$AUTOSTART" 2>/dev/null || true
    {
      echo "@xset s off"
      echo "@xset -dpms"
      echo "@xset s noblank"
      echo "@$LAUNCHER"
    } >> "$AUTOSTART"
    echo "    -> $AUTOSTART"
    ;;

  *)
    # Fall back to a desktop-agnostic autostart entry.
    mkdir -p "$HOME/.config/autostart"
    cat > "$HOME/.config/autostart/stelias-kiosk.desktop" <<DESKTOP_EOF
[Desktop Entry]
Type=Application
Name=St. Elias Kiosk
Exec=$LAUNCHER
X-GNOME-Autostart-enabled=true
DESKTOP_EOF
    echo "    -> $HOME/.config/autostart/stelias-kiosk.desktop"
    echo "    (Couldn't identify the desktop for certain -- if it doesn't come up"
    echo "     on the next reboot, see the Troubleshooting section of the README.)"
    ;;
esac

# --------------------------------------------------------------------------
# Nightly reboot
#
# Not strictly necessary, but a screen that has been running unattended since
# Pentecost is a screen that eventually shows something strange. 4am is safely
# after Vespers and well before anyone arrives.
# --------------------------------------------------------------------------

echo "==> Scheduling a nightly reboot at 4am"
CRON_LINE="0 4 * * * /sbin/shutdown -r now"
( crontab -l 2>/dev/null | grep -v 'shutdown -r now' || true; echo "$CRON_LINE" ) | crontab -

# --------------------------------------------------------------------------
# Remote access (optional)
# --------------------------------------------------------------------------

echo
read -r -p "Install Tailscale so you can reach this Pi from home? [y/N] " WANT_TS
if [[ "${WANT_TS,,}" == "y" ]]; then
  curl -fsSL https://tailscale.com/install.sh | sh
  echo
  echo "Now run:  sudo tailscale up"
  echo "It will print a link -- open it and sign in to add this Pi to your network."
fi

# --------------------------------------------------------------------------

cat <<DONE

---------------------------------------------------------------------------
Done.

  Address:   $KIOSK_URL
  Launcher:  $LAUNCHER
  Desktop:   $SESSION

Reboot to check it comes up on its own:

  sudo reboot

To try it right now without rebooting:

  $LAUNCHER

To get out of kiosk mode: press Ctrl+W, or Alt+F4, or plug in a keyboard and
press Ctrl+Alt+T for a terminal.

From here on, nobody needs to touch this Pi. Change the Google Sheet and the
screen follows along within a few minutes.
---------------------------------------------------------------------------
DONE
