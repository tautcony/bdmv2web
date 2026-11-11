package javax.media;

public class StopEvent extends ControllerEvent {
    private static final long serialVersionUID = 1L;
    private final Time mediaTime;
    public StopEvent(Controller source, int previousState, int currentState, int targetState, Time mediaTime) {
        super(source, previousState, currentState, targetState);
        this.mediaTime = mediaTime;
    }
    public Time getMediaTime() { return mediaTime; }
}
