package javax.media;

import com.bdmv2web.bdj.BdjHostBridge;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.bluray.media.PlaybackControl;
import org.bluray.media.PlaybackListener;
import org.bluray.media.PlaybackMarkEvent;
import org.bluray.media.PlaybackPlayItemEvent;
import org.davic.media.MediaPresentedEvent;

public final class BrowserPlayerProbe {
    public static void main(String[] args) {
        try { verify(args[0]); System.exit(0); }
        catch (Throwable error) { error.printStackTrace(); System.exit(1); }
    }

    private static void verify(String mode) throws Exception {
        BdjHostBridge.start();
        if ("identity".equals(mode)) {
            new BrowserPlayer("bd://PLAYLIST:00001").start();
            new BrowserPlayer("bd://PLAYLIST:00002").start();
            System.err.println("PLAYER_REQUESTED state=500 events=RealizeCompleteEvent,PrefetchCompleteEvent");
            System.err.println("PLAYER_PROBE_OK identity");
            return;
        }
        BrowserPlayer player = new BrowserPlayer("requested".equals(mode) ? "bd://PLAYLIST:00001" : "file:/bdj/BDMV/JAR/menu.wav");
        List<String> events = new CopyOnWriteArrayList<String>();
        List<Integer> marks = new CopyOnWriteArrayList<Integer>();
        List<Integer> items = new CopyOnWriteArrayList<Integer>();
        AtomicInteger presented = new AtomicInteger();
        PlaybackControl playback = (PlaybackControl) player.getControl(PlaybackControl.class.getName());
        PlaybackListener playbackListener = new PlaybackListener() {
            public void markReached(PlaybackMarkEvent event) { marks.add(Integer.valueOf(event.getMark())); playback.removePlaybackControlListener(this); }
            public void playItemReached(PlaybackPlayItemEvent event) { items.add(Integer.valueOf(event.getPlayItem())); }
        };
        playback.addPlaybackControlListener(playbackListener);
        CountDownLatch completed = new CountDownLatch(1);
        AtomicInteger endCount = new AtomicInteger();
        player.addControllerListener(event -> {
            events.add(event.getClass().getSimpleName());
            if (event instanceof MediaPresentedEvent) presented.incrementAndGet();
            if (event instanceof StartEvent) {
                System.err.println("PLAYER_STARTED state=" + player.getState());
                if ("stopped".equals(mode)) player.stop();
            }
            if (event instanceof EndOfMediaEvent && "reuse".equals(mode) && endCount.getAndIncrement() == 0) {
                player.start();
                System.err.println("PLAYER_RESTART_REQUESTED state=" + player.getState());
            } else if (event instanceof EndOfMediaEvent || event instanceof StopEvent || event instanceof ControllerErrorEvent) completed.countDown();
        });
        player.start();
        System.err.println("PLAYER_REQUESTED state=" + player.getState() + " events=" + String.join(",", events));
        if (player.getState() != Controller.Prefetched) throw new AssertionError("start request state");
        if ("requested".equals(mode) || "reuse".equals(mode)) {
            if (!String.join(",", events).equals("RealizeCompleteEvent,PrefetchCompleteEvent")) throw new AssertionError(events.toString());
            if (player.getMediaNanoseconds() != 0L) throw new AssertionError("unobserved media clock");
            if ("reuse".equals(mode)) {
                if (!completed.await(8, TimeUnit.SECONDS)) throw new AssertionError("media observation timeout");
                if (player.getState() != Controller.Prefetched) throw new AssertionError("reused completion state");
            }
        } else {
            if (!completed.await(8, TimeUnit.SECONDS)) throw new AssertionError("media observation timeout");
            String expected = "RealizeCompleteEvent,PrefetchCompleteEvent," + ("missing".equals(mode) ? "EndOfMediaEvent" : "StartEvent," + ("stopped".equals(mode) ? "StopEvent" : "contract".equals(mode) ? "MediaPresentedEvent,EndOfMediaEvent" : "EndOfMediaEvent"));
            if (!String.join(",", events).equals(expected)) throw new AssertionError(events.toString());
            if (player.getState() != Controller.Prefetched) throw new AssertionError("observed completion state");
        }
        if ("contract".equals(mode) && (presented.get() != 1 || !marks.equals(java.util.Collections.singletonList(Integer.valueOf(45))) || !items.equals(java.util.Collections.singletonList(Integer.valueOf(0))) || player.getMediaNanoseconds() < 2_000_000_000L)) throw new AssertionError("event contract " + events + " marks=" + marks + " items=" + items + " time=" + player.getMediaNanoseconds());
        System.err.println("PLAYER_PROBE_OK " + mode);
    }
}
