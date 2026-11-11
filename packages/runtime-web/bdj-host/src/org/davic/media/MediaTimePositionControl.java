package org.davic.media;

public interface MediaTimePositionControl extends javax.media.Control {
    public default javax.media.Time getMediaTimePosition() { return null; }
    public default javax.media.Time setMediaTimePosition(javax.media.Time a0) { return null; }
}
