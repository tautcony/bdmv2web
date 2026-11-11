package javax.media;

public class PrefetchCompleteEvent extends ControllerEvent {
    private static final long serialVersionUID = 1L;
    public PrefetchCompleteEvent(Controller source, int previousState, int currentState, int targetState) { super(source, previousState, currentState, targetState); }
}
