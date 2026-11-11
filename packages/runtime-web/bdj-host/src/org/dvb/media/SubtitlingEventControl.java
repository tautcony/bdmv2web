package org.dvb.media;

public interface SubtitlingEventControl extends org.davic.media.SubtitlingLanguageControl, javax.media.Control {
    public default void addSubtitleListener(org.dvb.media.SubtitleListener a0) {  }
    public default void removeSubtitleListener(org.dvb.media.SubtitleListener a0) {  }
}
