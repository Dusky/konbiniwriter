import { splitSentences, type Sentence } from '@shared/speech'

/**
 * Read-aloud proofing, on top of the Web Speech API.
 *
 * Prose is spoken one sentence at a time rather than as a single long
 * utterance. That costs a little smoothness and buys the two things that make
 * this useful: the sentence being read can be highlighted where the writer is
 * reading, and playback can start from the caret instead of the top.
 *
 * The API itself is quirky in ways worth naming:
 *  - Voices load asynchronously, and on first call `getVoices()` is often
 *    empty. `voiceschanged` is the only reliable signal.
 *  - Chrome silently stops long utterances after ~15s. Short, per-sentence
 *    utterances sidestep it entirely.
 *  - `cancel()` fires `onend` for the utterance in flight, which would look
 *    exactly like a sentence finishing normally and advance to the next one.
 *    A generation counter distinguishes the two.
 */
export interface ReadAloudState {
  speaking: boolean
  paused: boolean
  /** Index into the sentence list, or -1 when idle. */
  index: number
  sentences: Sentence[]
}

type Listener = (state: ReadAloudState) => void

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function'
}

class ReadAloudService {
  private listeners = new Set<Listener>()
  private state: ReadAloudState = { speaking: false, paused: false, index: -1, sentences: [] }
  /** Bumped on every stop; an utterance from an older generation is ignored. */
  private generation = 0
  private rate = 1
  private voiceURI: string | null = null

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => { this.listeners.delete(fn) }
  }

  getState(): ReadAloudState { return this.state }

  private emit(patch: Partial<ReadAloudState>): void {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn(this.state)
  }

  /** Available voices. May be empty until the browser has loaded them. */
  voices(): SpeechSynthesisVoice[] {
    return isSpeechSupported() ? window.speechSynthesis.getVoices() : []
  }

  /** Resolves once the browser has published its voice list. */
  whenVoicesReady(): Promise<SpeechSynthesisVoice[]> {
    if (!isSpeechSupported()) return Promise.resolve([])
    const now = this.voices()
    if (now.length) return Promise.resolve(now)
    return new Promise((resolve) => {
      const done = () => {
        window.speechSynthesis.removeEventListener('voiceschanged', done)
        resolve(this.voices())
      }
      window.speechSynthesis.addEventListener('voiceschanged', done)
      // Some browsers never fire the event when the list is genuinely empty.
      setTimeout(done, 1500)
    })
  }

  setRate(rate: number): void { this.rate = Math.min(2.5, Math.max(0.5, rate)) }
  setVoice(uri: string | null): void { this.voiceURI = uri }
  getRate(): number { return this.rate }
  getVoiceURI(): string | null { return this.voiceURI }

  /** Start reading `text`, beginning with the sentence containing `fromPos`. */
  start(text: string, fromIndex = 0): void {
    if (!isSpeechSupported()) return
    this.stop()
    const sentences = splitSentences(text)
    if (!sentences.length) return
    const index = Math.min(Math.max(fromIndex, 0), sentences.length - 1)
    this.emit({ sentences, index, speaking: true, paused: false })
    this.speakFrom(index, ++this.generation)
  }

  private speakFrom(index: number, generation: number): void {
    if (generation !== this.generation) return
    const { sentences } = this.state
    if (index >= sentences.length) { this.stop(); return }

    const u = new SpeechSynthesisUtterance(sentences[index].speak)
    u.rate = this.rate
    const voice = this.voices().find((v) => v.voiceURI === this.voiceURI)
    if (voice) { u.voice = voice; u.lang = voice.lang }

    const advance = () => {
      // A cancel() also fires onend; the generation check is what tells the
      // difference between "sentence finished" and "the writer hit stop".
      if (generation !== this.generation) return
      this.emit({ index: index + 1 })
      this.speakFrom(index + 1, generation)
    }
    u.onend = advance
    u.onerror = advance

    this.emit({ index })
    window.speechSynthesis.speak(u)
  }

  pause(): void {
    if (!isSpeechSupported() || !this.state.speaking) return
    window.speechSynthesis.pause()
    this.emit({ paused: true })
  }

  resume(): void {
    if (!isSpeechSupported() || !this.state.paused) return
    window.speechSynthesis.resume()
    this.emit({ paused: false })
  }

  stop(): void {
    if (!isSpeechSupported()) return
    this.generation++
    window.speechSynthesis.cancel()
    this.emit({ speaking: false, paused: false, index: -1 })
  }
}

export const readAloud = new ReadAloudService()
