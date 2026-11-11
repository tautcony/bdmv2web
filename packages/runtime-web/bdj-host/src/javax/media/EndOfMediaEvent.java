package javax.media;

public class EndOfMediaEvent extends StopEvent {
    private static final long serialVersionUID = 1L;
    public EndOfMediaEvent(Controller source, int previousState, int currentState, int targetState, Time mediaTime) { super(source, previousState, currentState, targetState, mediaTime); }
}
