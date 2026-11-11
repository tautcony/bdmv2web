package javax.tv.xlet;

public interface XletContext {
    String ARGS = "javax.tv.xlet.args";
    Object getXletProperty(String key);
    void notifyDestroyed();
    void notifyPaused();
    void resumeRequest();
    ClassLoader getClassLoader();
}
