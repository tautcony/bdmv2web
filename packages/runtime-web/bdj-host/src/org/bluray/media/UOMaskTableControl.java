package org.bluray.media;

public interface UOMaskTableControl extends javax.media.Control {
    public default boolean[] getMaskedUOTable() { return null; }
}
