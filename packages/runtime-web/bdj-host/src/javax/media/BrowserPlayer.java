package javax.media;

import com.bdmv2web.bdj.BdjHostBridge;
import java.awt.Component;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.UUID;
import javax.tv.media.AWTVideoSizeControl;
import javax.tv.media.MediaSelectControl;
import org.bluray.media.AngleControl;
import org.bluray.media.AsynchronousPiPControl;
import org.bluray.media.OverallGainControl;
import org.bluray.media.PiPControl;
import org.bluray.media.PlayListChangeControl;
import org.bluray.media.PlaybackControl;
import org.bluray.media.PlaybackListener;
import org.bluray.media.PlaybackMarkEvent;
import org.bluray.media.PlaybackPlayItemEvent;
import org.bluray.media.PrimaryAudioControl;
import org.bluray.media.PrimaryGainControl;
import org.bluray.media.SecondaryGainControl;
import org.bluray.media.SubtitlingControl;
import org.bluray.media.UOMaskTableControl;
import org.bluray.net.BDLocator;
import org.davic.media.MediaTimePositionControl;
import org.dvb.media.BackgroundVideoPresentationControl;

/** JMF state follows correlated media observations from the local host. */
final class BrowserPlayer implements Player {
    private final String id = UUID.randomUUID().toString();
    private final String source;
    private final CopyOnWriteArrayList<ControllerListener> listeners = new CopyOnWriteArrayList<ControllerListener>();
    private final List<Control> controls = new ArrayList<Control>();
    private final PlaybackFacade playbackControl = new PlaybackFacade();
    private final PlaylistControl playlistControl = new PlaylistControl();
    private final GainControlFacade gainControl = new GainControlFacade();
    private volatile int state = Controller.Unrealized;
    private volatile int targetState = Controller.Unrealized;
    private volatile float rate = 1f;
    private volatile long mediaNanos;
    private volatile long startedAtNanos;
    private volatile boolean stopRequested;
    private boolean mediaPresented;
    private long playbackGeneration;
    private String playbackToken;
    private long lastPositionNanos = -1;
    private int lastPlayItem = -1;
    private volatile Time stopTime = new Time(Long.MAX_VALUE);

    BrowserPlayer(String source) {
        this.source = source == null ? "" : source;
        playlistControl.current = new BDLocator(this.source);
        controls.add(playbackControl);
        controls.add(playlistControl);
        controls.add(new AudioFacade());
        controls.add(gainControl);
        controls.add(new SubtitleFacade());
        controls.add(new MediaSelectionFacade());
        controls.add(new BackgroundVideoFacade());
        controls.add(new MediaTimeFacade());
        controls.add(new AngleFacade());
        controls.add(new PiPFacade());
        controls.add(new VideoSizeFacade());
        controls.add(new UoMaskFacade());
    }

    public synchronized void realize() {
        if (state >= Controller.Realized) return;
        int before = state; state = Controller.Realized; targetState = state;
        fire(new RealizeCompleteEvent(this, before, state, targetState));
    }

    public synchronized void prefetch() {
        if (state >= Controller.Prefetched) return;
        realize();
        int before = state; state = Controller.Prefetched; targetState = state;
        fire(new PrefetchCompleteEvent(this, before, state, targetState));
    }

    public synchronized void start() {
        if (state == Controller.Started || targetState == Controller.Started) return;
        prefetch();
        targetState = Controller.Started;
        final long generation = ++playbackGeneration;
        mediaPresented = false;
        lastPositionNanos = -1L;
        lastPlayItem = -1;
        final String token = id + ":" + generation;
        if (playbackToken != null) BdjHostBridge.unregisterPlayer(playbackToken);
        playbackToken = token;
        BdjHostBridge.registerPlayer(token, event -> {
            synchronized (BrowserPlayer.this) {
                if (generation != playbackGeneration || !token.equals(playbackToken)) {
                    BdjHostBridge.trace("javax.media.BrowserPlayer", "handleHostEvent", "stale", "owner=" + id + " generation=" + generation + " currentGeneration=" + playbackGeneration + " event=" + event);
                    return;
                }
                handleHostEvent(event);
            }
        });
        BdjHostBridge.trace("javax.media.BrowserPlayer", "start", "request", "owner=" + id + " token=" + token + " source=" + source + " playlist=" + playlistControl.current.getPlayListId() + " state=" + state + " target=" + targetState + " caller=" + caller());
        String result;
        try {
            if (playlistControl.current.getPlayListId() >= 0) {
                result = BdjHostBridge.call("playerStart", token, id, "playlist", Integer.toString(playlistControl.current.getPlayListId()));
            } else {
                result = BdjHostBridge.call("playerStart", token, id, "resource", source);
            }
        } catch (RuntimeException error) {
            BdjHostBridge.unregisterPlayer(token);
            playbackToken = null;
            int before = state; state = Controller.Prefetched; targetState = state;
            fire(new ControllerErrorEvent(this, before, state, targetState, error.getMessage()));
            return;
        }
        if ("requested".equals(result) || "pending".equals(result)) return;
        if ("started".equals(result)) handleHostEvent("started");
        else {
            BdjHostBridge.unregisterPlayer(token);
            playbackToken = null;
            targetState = state;
            fire(new ControllerErrorEvent(this, "Media start " + result + " for " + source));
        }
    }

    public synchronized void stop() {
        if (stopRequested || (state != Controller.Started && targetState != Controller.Started)) return;
        String result = BdjHostBridge.call("playerStop", playbackToken == null ? "" : playbackToken);
        if ("pending".equals(result)) { stopRequested = true; targetState = Controller.Prefetched; }
        else if ("stopped".equals(result)) handleHostEvent("stopped");
        else BdjHostBridge.trace("javax.media.BrowserPlayer", "stop", "unavailable", source + ": " + result);
    }

    public synchronized void close() {
        BdjHostBridge.trace("javax.media.BrowserPlayer", "close", "request", "owner=" + id + " token=" + playbackToken + " source=" + source + " playlist=" + playlistControl.current.getPlayListId() + " state=" + state + " target=" + targetState + " caller=" + caller());
        if (state == Controller.Started || targetState == Controller.Started) {
            try { stop(); }
            catch (RuntimeException error) { BdjHostBridge.trace("javax.media.BrowserPlayer", "close", "error", error.toString()); }
        }
        int before = state; state = Controller.Unrealized; targetState = state;
        stopRequested = false;
        if (before != state) fire(new ControllerEvent(this, before, state, targetState));
        if (playbackToken != null) BdjHostBridge.unregisterPlayer(playbackToken);
        playbackToken = null;
        playbackGeneration++;
    }

    public void deallocate() { if (state == Controller.Started) stop(); if (state > Controller.Realized) state = Controller.Realized; }
    public void addControllerListener(ControllerListener listener) { if (listener != null) listeners.addIfAbsent(listener); }
    public void removeControllerListener(ControllerListener listener) { listeners.remove(listener); }
    public Control getControl(String type) { for (Control control : controls) if (control.getClass().getName().equals(type) || implementsType(control, type)) return control; return null; }
    public Control[] getControls() { return controls.toArray(new Control[0]); }
    public int getState() { return state; }
    public int getTargetState() { return targetState; }
    public Time getStartTime() { return new Time(0L); }
    public long getStartLatency() { return 0L; }
    public Time getDuration() { return Duration.DURATION_UNKNOWN; }
    public Component getVisualComponent() { return null; }
    public Component getControlPanelComponent() { return null; }
    public GainControl getGainControl() { return gainControl; }
    public Time getMediaTime() { return new Time(getMediaNanoseconds()); }
    public long getMediaNanoseconds() { return state == Controller.Started ? mediaNanos + (long) ((System.nanoTime() - startedAtNanos) * rate) : mediaNanos; }
    public float getRate() { return rate; }
    public Time getStopTime() { return stopTime; }
    public Time setMediaTime(Time value) { mediaNanos = value == null ? 0L : value.getNanoseconds(); startedAtNanos = System.nanoTime(); return getMediaTime(); }
    public float setRate(float value) { rate = value; return value; }
    public void setStopTime(Time value) { stopTime = value == null ? new Time(Long.MAX_VALUE) : value; }

    private synchronized void handleHostEvent(String event) {
        BdjHostBridge.trace("javax.media.BrowserPlayer", "handleHostEvent", "received", source + " event=" + event + " state=" + state + " target=" + targetState);
        if ("started".equals(event) && targetState == Controller.Started && state != Controller.Started) {
            int before = state; state = Controller.Started; startedAtNanos = System.nanoTime();
            fire(new StartEvent(this, before, state, targetState, getMediaTime(), new Time(System.nanoTime())));
        } else if ("presented".equals(event) && !mediaPresented) {
            mediaPresented = true;
            fire(new org.davic.media.MediaPresentedEvent(this));
        } else if (event.startsWith("position|")) {
            if (state != Controller.Started) return;
            String[] fields = event.split("\\|", -1);
            try {
                long position = Long.parseLong(fields[1]);
                int item = Integer.parseInt(fields[2]);
                mediaNanos = position; startedAtNanos = System.nanoTime();
                if (item != lastPlayItem) { lastPlayItem = item; playbackControl.firePlayItem(item); }
                if (fields.length > 3 && !fields[3].isEmpty()) {
                    int mark = Integer.parseInt(fields[3]);
                    playbackControl.fireMark(mark);
                }
                lastPositionNanos = position;
            } catch (NumberFormatException ignored) { BdjHostBridge.trace("javax.media.BrowserPlayer", "position", "invalid", event); }
        } else if (("ended".equals(event) || event.startsWith("missing-ended|")) && (state == Controller.Started || targetState == Controller.Started)) {
            if (event.startsWith("missing-ended|")) BdjHostBridge.trace("javax.media.BrowserPlayer", "missingSkip", "terminal", source + " " + event + " state=" + state);
            mediaNanos = getMediaNanoseconds();
            int before = state; state = Controller.Prefetched; targetState = state; stopRequested = false;
            fire(new EndOfMediaEvent(this, before, state, targetState, new Time(mediaNanos)));
        } else if ("stopped".equals(event) && (state == Controller.Started || targetState == Controller.Started || stopRequested)) {
            mediaNanos = getMediaNanoseconds();
            int before = state; state = Controller.Prefetched; targetState = state; stopRequested = false;
            fire(new StopEvent(this, before, state, targetState, new Time(mediaNanos)));
        } else if ("error".equals(event) || "unavailable".equals(event)) {
            int before = state; state = Controller.Prefetched; targetState = state; stopRequested = false;
            fire(new ControllerErrorEvent(this, before, state, targetState, "Media playback " + event + " for " + source));
        } else if ("blocked".equals(event)) {
            BdjHostBridge.trace("javax.media.BrowserPlayer", "start", "blocked", source);
        }
    }

    private void fire(ControllerEvent event) {
        String detail = source + " event=" + event.getClass().getName() + " previous=" + event.getPreviousState() + " current=" + event.getCurrentState() + " target=" + event.getTargetState() + " listeners=" + listeners.size();
        BdjHostBridge.trace("javax.media.BrowserPlayer", "fire", "dispatch", detail);
        for (ControllerListener listener : listeners) {
            String listenerClass = listener.getClass().getName();
            BdjHostBridge.trace("javax.media.BrowserPlayer", "controllerUpdate", "enter", listenerClass + " " + detail);
            try {
                listener.controllerUpdate(event);
                BdjHostBridge.trace("javax.media.BrowserPlayer", "controllerUpdate", "return", listenerClass + " " + detail);
            } catch (Throwable error) {
                BdjHostBridge.trace("javax.media.BrowserPlayer", "controllerUpdate", "error", listenerClass + " " + error.toString());
            }
        }
    }
    private static String caller() {
        StackTraceElement[] stack = Thread.currentThread().getStackTrace();
        StringBuilder result = new StringBuilder();
        for (int index = 2; index < stack.length; index++) {
            StackTraceElement frame = stack[index];
            if (frame.getClassName().equals(BrowserPlayer.class.getName()) || frame.getClassName().equals(Thread.class.getName())) continue;
            if (result.length() > 0) result.append(" <- ");
            result.append(frame.getClassName()).append('.').append(frame.getMethodName()).append(':').append(frame.getLineNumber());
            if (result.length() > 180) break;
        }
        return result.length() == 0 ? "unknown" : result.toString();
    }
    private static boolean implementsType(Object value, String type) {
        try { return Class.forName(type, false, value.getClass().getClassLoader()).isInstance(value); }
        catch (ClassNotFoundException ignored) { return false; }
    }

    private final class PlaylistControl implements PlayListChangeControl {
        private volatile BDLocator current;
        public BDLocator getCurrentPlayList() { return current; }
        public void selectPlayList(BDLocator locator) {
            if (locator == null || locator.getPlayListId() < 0) return;
            String result = BdjHostBridge.call("playerPlaylist", id, Integer.toString(locator.getPlayListId()));
            if ("selected".equals(result)) current = locator;
        }
    }

    private final class PlaybackFacade implements PlaybackControl {
        private final CopyOnWriteArrayList<PlaybackListener> playbackListeners = new CopyOnWriteArrayList<PlaybackListener>();
        public void addPlaybackControlListener(PlaybackListener listener) { if (listener != null) playbackListeners.addIfAbsent(listener); }
        public void removePlaybackControlListener(PlaybackListener listener) { playbackListeners.remove(listener); }
        private void fireMark(int mark) { PlaybackMarkEvent event = new PlaybackMarkEvent(this, mark); for (PlaybackListener listener : playbackListeners) listener.markReached(event); }
        private void firePlayItem(int item) { PlaybackPlayItemEvent event = new PlaybackPlayItemEvent(this, item); for (PlaybackListener listener : playbackListeners) listener.playItemReached(event); }
        public void skipToMark(int mark) { BdjHostBridge.call("playerNavigate", id, "mark", Integer.toString(mark)); }
        public void skipToPlayItem(int item) { BdjHostBridge.call("playerNavigate", id, "item", Integer.toString(item)); }
        public boolean skipToNextMark(int delta) { return Boolean.parseBoolean(BdjHostBridge.call("playerNavigate", id, "nextMark", Integer.toString(delta))); }
        public boolean skipToPreviousMark(int delta) { return Boolean.parseBoolean(BdjHostBridge.call("playerNavigate", id, "previousMark", Integer.toString(delta))); }
    }

    private final class AudioFacade implements PrimaryAudioControl {
        public int getCurrentStreamNumber() {
            String result = BdjHostBridge.call("playerCurrentAudioStream", id);
            try { return Integer.parseInt(result); } catch (NumberFormatException ignored) { return 0; }
        }
        public int[] listAvailableStreamNumbers() {
            String result = BdjHostBridge.call("playerListAudioStreams", id);
            if (result.isEmpty()) return new int[0];
            String[] values = result.split(",");
            int[] streams = new int[values.length];
            for (int index = 0; index < values.length; index++) streams[index] = Integer.parseInt(values[index]);
            return streams;
        }
        public void selectStreamNumber(int number) { BdjHostBridge.call("playerStream", id, "audio", Integer.toString(number)); }
    }

    private final class GainControlFacade implements PrimaryGainControl, SecondaryGainControl, OverallGainControl {
        private volatile boolean muted;
        private volatile float level = 1f;
        public boolean getMute() { return muted; }
        public void setMute(boolean value) { muted = value; BdjHostBridge.call("playerGain", id, "mute", Boolean.toString(value)); }
        public float getLevel() { return level; }
        public float setLevel(float value) { level = Math.max(0f, Math.min(1f, value)); BdjHostBridge.call("playerGain", id, "level", Float.toString(level)); return level; }
    }

    private final class SubtitleFacade implements SubtitlingControl {
        public int getCurrentStreamNumber() { return 0; }
        public int[] listAvailableStreamNumbers() { return new int[0]; }
        public void selectStreamNumber(int number) { BdjHostBridge.call("playerStream", id, "subtitle", Integer.toString(number)); }
    }

    private final class MediaSelectionFacade implements MediaSelectControl { }
    private final class BackgroundVideoFacade implements BackgroundVideoPresentationControl { }
    private final class MediaTimeFacade implements MediaTimePositionControl {
        public Time getMediaTimePosition() { return getMediaTime(); }
        public Time setMediaTimePosition(Time value) { return setMediaTime(value); }
    }
    private final class AngleFacade implements AngleControl { }
    private final class PiPFacade implements PiPControl, AsynchronousPiPControl { }
    private final class VideoSizeFacade implements AWTVideoSizeControl { }
    private final class UoMaskFacade implements UOMaskTableControl { public boolean[] getMaskedUOTable() { return new boolean[64]; } }
}
