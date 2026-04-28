using System;
using System.Speech.Recognition;
using System.Threading;

// Say "Hey Casa" several times during this test to see how the engine transcribes it

class WakeTest {
    static void Main() {
        Console.WriteLine("=== Wake Word Transcription Test ===");
        Console.WriteLine("Say 'Hey Casa' several times in the next 15 seconds");
        Console.WriteLine("This shows EXACTLY what the engine hears");
        Console.WriteLine("---");

        var eng = new SpeechRecognitionEngine(new System.Globalization.CultureInfo("en-US"));
        eng.SetInputToDefaultAudioDevice();
        eng.LoadGrammar(new DictationGrammar());

        eng.SpeechRecognized += (s, e) => {
            Console.WriteLine("HEARD: \"" + e.Result.Text + "\" (conf:" + e.Result.Confidence.ToString("F2") + ")");
        };
        eng.SpeechRecognitionRejected += (s, e) => {
            Console.WriteLine("REJECTED (too low confidence)");
        };

        eng.RecognizeAsync(RecognizeMode.Multiple);
        Thread.Sleep(15000);
        eng.RecognizeAsyncStop();
        Thread.Sleep(500);
        Console.WriteLine("---\nDone. Use the exact transcriptions above to update the wake word matcher.");
    }
}
