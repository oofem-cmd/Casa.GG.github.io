using System;
using System.Speech.Recognition;
using System.Speech.AudioFormat;

class Diag {
    static void Main() {
        Console.WriteLine("=== Installed Recognizers ===");
        var recognizers = SpeechRecognitionEngine.InstalledRecognizers();
        Console.WriteLine("Count: " + recognizers.Count);
        foreach (var r in recognizers) {
            Console.WriteLine("  Name: " + r.Name);
            Console.WriteLine("  Culture: " + r.Culture.Name);
            Console.WriteLine("  Description: " + r.Description);
        }

        if (recognizers.Count == 0) {
            Console.WriteLine("NO RECOGNIZERS FOUND. Install Offline Speech Recognition:");
            Console.WriteLine("Settings > Time & Language > Speech > Offline Speech Recognition");
            return;
        }

        Console.WriteLine("\n=== Testing Audio Device ===");
        try {
            var eng = new SpeechRecognitionEngine();
            eng.SetInputToDefaultAudioDevice();
            Console.WriteLine("Audio device: OK");
            eng.Dispose();
        } catch (Exception ex) {
            Console.WriteLine("Audio device FAILED: " + ex.Message);
        }

        Console.WriteLine("\n=== Testing en-US Recognizer ===");
        try {
            var eng = new SpeechRecognitionEngine(new System.Globalization.CultureInfo("en-US"));
            eng.SetInputToDefaultAudioDevice();
            Console.WriteLine("en-US engine: OK");
            eng.Dispose();
        } catch (Exception ex) {
            Console.WriteLine("en-US engine FAILED: " + ex.Message);
        }

        Console.WriteLine("\nDone.");
    }
}