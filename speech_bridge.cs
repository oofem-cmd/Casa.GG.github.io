using System;
using System.Globalization;
using System.Speech.Recognition;
using System.Threading;

// Two-mode bridge:
//   Wake mode   → exact "hey casa" grammar, confidence >= 0.75
//   Dictation   → DictationGrammar, stays open until renderer sends "wake"
// Mode switch on background thread so stdin loop never blocks.

class SpeechBridge {
    static SpeechRecognitionEngine _eng;
    static Grammar _wakeGrammar;
    static volatile bool _dictMode  = false;
    static volatile bool _paused    = false;
    static volatile bool _switching = false;
    static readonly CultureInfo EN  = new CultureInfo("en-US");

    static void Main() {
        try {
            _eng = new SpeechRecognitionEngine(EN);
            _eng.SetInputToDefaultAudioDevice();
            // Wait 1.5 s of silence before finalising — avoids cutting off mid-sentence
            _eng.EndSilenceTimeout          = TimeSpan.FromMilliseconds(1500);
            _eng.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(2000);
            // Give up to 10 s of initial silence before aborting a recognition
            _eng.InitialSilenceTimeout = TimeSpan.FromSeconds(10);

            // "hey casa" = start listening  |  "ok casa" = stop speaking
            var gb = new GrammarBuilder(new Choices("hey casa", "ok casa"));
            gb.Culture = EN;
            _wakeGrammar = new Grammar(gb);

            _eng.LoadGrammar(_wakeGrammar);
            _eng.SpeechRecognized += OnRecognized;
            _eng.RecognizeAsync(RecognizeMode.Multiple);

            Emit("ready", "", 0f);
            Emit("mode",  "wake", 0f);

            string line;
            while ((line = Console.ReadLine()) != null) {
                switch (line.Trim().ToLower()) {
                    case "dictate": _paused = false; BeginSwitch(true);  break;
                    case "wake":    _paused = false; BeginSwitch(false); break;
                    case "pause":
                        _paused = true;
                        BeginSwitch(false);
                        break;
                    case "resume":
                        _paused = false;
                        Emit("mode", "wake", 0f);
                        break;
                    case "ping":
                        Emit("pong", "", 0f);
                        break;
                    case "exit":
                        try { _eng.RecognizeAsyncCancel(); } catch {}
                        return;
                }
            }
        } catch (Exception ex) {
            Emit("error", ex.Message, 0f);
        }
    }

    static void BeginSwitch(bool toDict) {
        if (_switching) return;
        _switching = true;
        _dictMode  = toDict;
        ThreadPool.QueueUserWorkItem(delegate {
            try {
                _eng.RecognizeAsyncCancel();
                Thread.Sleep(120);
                _eng.UnloadAllGrammars();
                if (toDict) {
                    _eng.LoadGrammar(new DictationGrammar());
                } else {
                    _eng.LoadGrammar(_wakeGrammar);
                }
                _eng.RecognizeAsync(RecognizeMode.Multiple);
                if (!_paused) Emit("mode", toDict ? "dictation" : "wake", 0f);
            } catch (Exception ex) {
                Emit("error", "Switch error: " + ex.Message, 0f);
            } finally {
                _switching = false;
            }
        });
    }

    static void OnRecognized(object sender, SpeechRecognizedEventArgs e) {
        if (_paused || _switching) return;
        string text = (e.Result.Text ?? "").Trim();
        if (_dictMode) {
            // Emit the spoken text — renderer will decide whether to use it or cancel
            Emit("speech", text, e.Result.Confidence);
            // Stay in dictation mode until renderer sends "wake"
        } else {
            if (e.Result.Confidence < 0.75f) return;
            string lower = text.ToLower();
            if (lower == "ok casa")
                Emit("stop", text, e.Result.Confidence);
            else
                Emit("wake", text, e.Result.Confidence);
        }
    }

    static void Emit(string evt, string text, float conf) {
        string safe = (text ?? "")
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\n", "\\n")
            .Replace("\r", "");
        Console.WriteLine(
            "{\"event\":\"" + evt + "\"" +
            ",\"text\":\""  + safe + "\"" +
            ",\"confidence\":" + conf.ToString("F2") + "}");
        Console.Out.Flush();
    }
}
