package org.bluray.media;

public interface PlayListChangeControl extends javax.media.Control {
    public default org.bluray.net.BDLocator getCurrentPlayList() { return null; }
    public default void selectPlayList(org.bluray.net.BDLocator locator) { }
}
