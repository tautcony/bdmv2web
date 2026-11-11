package javax.media;

public interface Controller extends Clock {
    int Unrealized = 100;
    int Realizing = 200;
    int Realized = 300;
    int Prefetching = 400;
    int Prefetched = 500;
    int Started = 600;
    void addControllerListener(ControllerListener listener);
    Control getControl(String type);
    Control[] getControls();
    int getState();
    int getTargetState();
    void prefetch();
    void realize();
    void removeControllerListener(ControllerListener listener);
    void close();
    void deallocate();
    Time getStartTime();
    long getStartLatency();
}
