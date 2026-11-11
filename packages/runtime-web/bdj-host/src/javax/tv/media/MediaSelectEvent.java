package javax.tv.media;

public class MediaSelectEvent extends java.util.EventObject {
    private static final long serialVersionUID = 1L;
    private final javax.tv.locator.Locator[] selection;
    public MediaSelectEvent(Object source, javax.tv.locator.Locator[] selection) {
        super(source);
        this.selection = selection.clone();
    }
    public javax.tv.locator.Locator[] getSelection() { return selection.clone(); }
}
