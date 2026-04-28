using System;
using System.Speech.Recognition;
using System.Threading;

class ListenTest {
    static int _detected = 0;
    static int _recognized = 0;

    static void Main() {
        Console.WriteLine("Starting 10-second listen test...");
        Console.WriteLine("SPEAK INTO YOUR MIC NOW");
        Console.WriteLine("---");

        var eng = new SpeechRecognitionEngine(new System.Globalization.CultureInfo("en-US"));
        eng.SetInputToDefaultAudioDevice();
        eng.LoadGrammar(new DictationGrammar());

        eng.SpeechDetected += (s, e) => {
            _detected++;
            Console.WriteLine("[" + DateTime.Now.ToString("HH:mm:ss") + "] AUDIO DETECTED (event #" + _detected + ")");
        };

        eng.SpeechRecognized += (s, e) => {
            _recognized++;
            Console.WriteLine("[" + DateTime.Now.ToString("HH:mm:ss") + "] RECOGNIZED: \"" + e.Result.Text + "\" (confidence: " + e.Result.Confidence.ToString("F2") + ")");
        };

        eng.SpeechRecognitionRejected += (s, e) => {
            Console.WriteLine("[" + DateTime.Now.ToString("HH:mm:ss") + "] REJECTED (low confidence)");
        };

        eng.RecognizeAsync(RecognizeMode.Multiple);

        Thread.Sleep(10000);

        eng.RecognizeAsyncStop();
        Thread.Sleep(500);

        Console.WriteLine("---");
        Console.WriteLine("Results: " + _detected + " audio events, " + _recognized + " recognized phrases");
        if (_detected == 0) {
            Console.WriteLine("NO AUDIO DETECTED - microphone is not reaching the engine");
            Console.WriteLine("Check: Windows Settings > Privacy > Microphone > allow desktop apps");
        } else if (_recognized == 0) {
            Console.WriteLine("Audio detected but nothing recognized - try speaking more clearly");
        } else {
            Console.WriteLine("Speech recognition is working!");
        }
    }
}
