# Audio post: música, SFX y mezcla

Leé esto cuando el video lleve música o cuando el audio se sienta vacío pese a
tener voz.

## Los números

| Pista | Objetivo | Por qué |
|---|---|---|
| Voz | −16 LUFS, TP −1,5 dBTP | Es la referencia; todo lo demás se mide contra ella |
| Música | −20 LUFS | 4 LU abajo no alcanza: tiene que *desaparecer* bajo la voz |
| SFX | pico −6 dBFS, gain por cue | Un SFX que compite con la voz se come una palabra |
| Mezcla final | −15 a −14 LUFS, TP ≤ −1,5 dBTP | Lo que piden las plataformas y lo que evita clipping en el celular |

El error más común: normalizar cada pista por separado y no medir la mezcla.
Se mide el archivo final con `ffmpeg -af ebur128=peak=true`.

## Ducking

La música baja sola cuando entra la voz. Cadena probada (video de 30 s, cama a
−19 LUFS, mezcla final −15,4 LUFS y TP −1,5):

```bash
ffmpeg -i final-raw.mp4 -i bed.wav -filter_complex \
"[1:a]volume=-1dB,atrim=0:30.02[bed]; \
 [bed][0:a]sidechaincompress=threshold=0.02:ratio=8:attack=5:release=300[duck]; \
 [0:a][duck]amix=inputs=2:duration=first:dropout_transition=0,loudnorm=I=-15:TP=-1.5[mix]" \
-map 0:v -map "[mix]" -c:v copy -c:a aac -b:a 192k mezcla.mp4
```

`threshold` bajo = la música se aparta con poco nivel de voz. Si la voz tiene
mucho silencio entre líneas, subí `release` para que no "bombeé" en cada
respiración.

**Verificar sin escuchar** que el ducking funciona: medir RMS de la mezcla en
un hueco de voz y sobre la voz, y comparar con la versión sin música.

```bash
ffmpeg -ss 3.45 -t 0.3 -i mezcla.mp4 -af astats -f null -   # hueco
ffmpeg -ss 1.00 -t 1.0 -i mezcla.mp4 -af astats -f null -   # voz
```

Ejemplo real: en el hueco, sin música −inf y con música −17,6 dB (la cama
llena el silencio); sobre la voz, −15,27 contra −14,74 dB (la música suma
0,5 dB). Si sobre la voz suma más de 2 dB, está tapando palabras.

## Cama original cuando no hay pista

Si no hay track con licencia, se puede **sintetizar** una cama en el estilo
(80s synth: bombo, caja, hi-hat, bajo en corcheas, pad y arpegio) con un script
que escriba el WAV muestra por muestra. Es original y no depende de terceros,
pero **no reemplaza a un tema compuesto**: sirve de base rítmica, no de gancho
melódico. Reglas que hacen la diferencia:

- Separá buses (batería vs armonía) y aplicá **sidechain al bombo**; sin eso la
  cama queda como una pared y no se siente el pulso.
- Apuntá a RMS ≈ −18 dBFS y pico ≈ −2 dBFS antes de mezclar; si el crest factor
  da menos de 2, está todo saturado.
- El arpegio en 16avos compite con la voz: en un video hablado, 8vos.
- Aun así, alguien tiene que escucharla. Un agente puede medir, no juzgar gusto.

## Licencia: sin esto no entra

Toda pista va a `assets/manifest.json` con `origen`, `license`, `url` y
`addedAt`. Sin licencia, no se monta. Reglas prácticas:

- Biblioteca con licencia (Pixabay, Artlist, Epidemic): guardá el nombre exacto
  del tema y la fecha de descarga; la licencia cambia con el tiempo.
- **CC-BY-NC no sirve si el video se vende o monetiza.** MusicGen local es
  CC-BY-NC: sirve para probar, no para entregar.
- Un tema de terceros "de fondo" no es uso libre aunque sea un fragmento.
- Si el cliente trae la pista, pedile por escrito el derecho de sincronización.

## No entregues audio que no escuchaste

Un agente no puede juzgar si una cama musical "queda bien". Por eso:

1. La persona elige o aprueba la pista.
2. El agente mide, mezcla y deja el archivo listo.
3. Si no hay pista aprobada, **se entrega sin música** y se dice. Una cama
   sintetizada a ciegas suena peor que el silencio y no se puede defender.

## SFX

- Densidad: sale de `style.json` (`audio.sfxDensityPerMinute`), medida de las
  referencias. No se pone un SFX en cada corte porque sí.
- Sintetizados con ffmpeg alcanzan para whoosh/pop/click; para impactos o
  risers conviene un pack con licencia.
- Cada cue lleva `asset`, `at` (absoluto) y `gainDb`. El `at` relativo al beat
  se calcula al armar el cue-sheet, no a mano.

## QA

- `render_qa.mjs` mide loudness y true peak del render final.
- Si el true peak da `?`, es que el filtro se corrió sin `peak=true`.
- Un video con música y voz tiene que seguir entendiéndose con el teléfono al
  30 % de volumen: si no, la música está alta.
