package org.davic.media;

public class MediaPresentedEvent extends javax.media.ControllerEvent {
    private static final long serialVersionUID = 133581431805272182L;
    public MediaPresentedEvent(javax.media.Controller source) {
        super(source, source.getState(), source.getState(), source.getTargetState());
    }
}
