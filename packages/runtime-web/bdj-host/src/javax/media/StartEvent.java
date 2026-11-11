package javax.media;

public class StartEvent extends ControllerEvent {
    private static final long serialVersionUID = 1L;
    private final Time mediaTime;
    private final Time timeBaseTime;
    public StartEvent(Controller source, int previousState, int currentState, int targetState, Time mediaTime, Time timeBaseTime) {
        super(source, previousState, currentState, targetState);
        this.mediaTime = mediaTime;
        this.timeBaseTime = timeBaseTime;
    }
    public Time getMediaTime() { return mediaTime; }
    public Time getTimeBaseTime() { return timeBaseTime; }
}
