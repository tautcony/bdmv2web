package javax.media;

public interface Duration {
    Time DURATION_UNKNOWN = new Time(-1L);
    Time DURATION_UNBOUNDED = new Time(Long.MAX_VALUE);
    Time getDuration();
}
