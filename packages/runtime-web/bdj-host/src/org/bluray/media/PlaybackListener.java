package org.bluray.media;

public interface PlaybackListener extends java.util.EventListener {
    void markReached(PlaybackMarkEvent event);
    void playItemReached(PlaybackPlayItemEvent event);
}
