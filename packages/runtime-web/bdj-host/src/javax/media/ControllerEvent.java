package javax.media;

import java.util.EventObject;

public class ControllerEvent extends EventObject {
    private static final long serialVersionUID = 1L;
    private final int previousState;
    private final int currentState;
    private final int targetState;
    public ControllerEvent(Controller source, int previousState, int currentState, int targetState) {
        super(source);
        this.previousState = previousState;
        this.currentState = currentState;
        this.targetState = targetState;
    }
    public Controller getSourceController() { return (Controller) getSource(); }
    public int getPreviousState() { return previousState; }
    public int getCurrentState() { return currentState; }
    public int getTargetState() { return targetState; }
    public String toString() { return getClass().getSimpleName() + "[" + previousState + "→" + currentState + "]"; }
}
