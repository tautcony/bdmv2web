package org.bluray.media;

public class PlaybackPlayItemEvent extends java.util.EventObject {
    private static final long serialVersionUID = 1L;
    private final int playItem;
    public PlaybackPlayItemEvent(PlaybackControl source, int playItem) { super(source); this.playItem = playItem; }
    public int getPlayItem() { return playItem; }
}
