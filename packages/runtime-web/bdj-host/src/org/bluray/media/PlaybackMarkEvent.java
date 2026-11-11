package org.bluray.media;

public class PlaybackMarkEvent extends java.util.EventObject {
    private static final long serialVersionUID = 1L;
    private final int mark;
    public PlaybackMarkEvent(PlaybackControl source, int mark) { super(source); this.mark = mark; }
    public int getMark() { return mark; }
}
