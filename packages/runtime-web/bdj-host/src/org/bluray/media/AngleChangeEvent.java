package org.bluray.media;

public class AngleChangeEvent extends java.util.EventObject {
    private static final long serialVersionUID = 1L;
    private final int angle;
    public AngleChangeEvent(AngleControl source, int angle) { super(source); this.angle = angle; }
    public int getAngle() { return angle; }
}
