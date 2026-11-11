package javax.media;

public class ControllerErrorEvent extends ControllerEvent {
    private static final long serialVersionUID = 1L;
    private final String message;
    public ControllerErrorEvent(Controller source, int previousState, int currentState, int targetState, String message) {
        super(source, previousState, currentState, targetState);
        this.message = message == null ? "Controller error" : message;
    }
    public ControllerErrorEvent(Controller source, String message) { this(source, source.getState(), source.getState(), source.getTargetState(), message); }
    public String getMessage() { return message; }
}
