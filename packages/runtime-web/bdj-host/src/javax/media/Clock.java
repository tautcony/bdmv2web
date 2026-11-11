package javax.media;

public interface Clock {
    Time getMediaTime();
    long getMediaNanoseconds();
    float getRate();
    Time getStopTime();
    Time setMediaTime(Time mediaTime);
    float setRate(float rate);
    void setStopTime(Time stopTime);
    void stop();
}
