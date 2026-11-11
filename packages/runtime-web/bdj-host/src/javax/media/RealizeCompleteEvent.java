package javax.media;

public class RealizeCompleteEvent extends ControllerEvent {
    private static final long serialVersionUID = 1L;
    public RealizeCompleteEvent(Controller source, int previousState, int currentState, int targetState) { super(source, previousState, currentState, targetState); }
}
