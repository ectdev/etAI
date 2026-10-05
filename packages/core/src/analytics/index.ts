/**
 * Recording what the system was asked, kept behind its own entry point.
 *
 * Every surface that answers a question calls this, which is the point: the dashboard
 * reports on one table and there is one function that writes to it.
 */
export { recordQuestion, analyticsRecordingFailures, type QuestionRecord } from './record.js';
