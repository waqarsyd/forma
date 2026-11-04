"""
Fine-tune Forma's vision model on Kaggle's free GPU (2026-11-03, milestone 6
of docs/proposals/own-model.md).

The model is Qwen3.5-2B (Apache-2.0), with a 16-bit LoRA through Unsloth.
It learns to look at a picture of a report page and write the page's skeleton
in the text of src/lib/skeletonText.ts.

In a Kaggle notebook:
- Settings: Accelerator "GPU T4 x2" (only one is used), Internet on. Not the
  P100: Unsloth needs compute capability 7.0 and the P100 is 6.0.
- Input: your private dataset "Forma report skeletons". It can be just the
  examples.jsonl that `npm run model:dataset` writes, 4.7 MB of skeletons,
  and the pages are then drawn here. Or it can be the folder after
  `python scripts/model/render.py` has drawn them, zipped or not.

    !wget -q -O train_vision.py https://raw.githubusercontent.com/waqarsyd/forma/main/scripts/model/kaggle/train_vision.py
    !python train_vision.py --setup     # installs Unsloth, once per session
    !python train_vision.py --smoke     # 40 images and 20 steps: proves every step works
    !python train_vision.py --train --merge   # the full run, then the merged model; best as "Save Version", Run All
    !python train_vision.py --export --check  # in a CPU session with that version as input: the GGUF and
                                              # projector, then llama.cpp and Ollama run them, no GPU hours

Everything is written to /kaggle/working, which is kept with a saved
version:
- lora/              the adapter;
- predictions.jsonl  the model's answer for held-out pages, next to the
                     right one, for scripts on the Forma side to score;
- gguf/              after --export: forma-vision-Q8_0.gguf and the
                     vision projector, mmproj-*.gguf, kept at F16.

The installation follows Unsloth's own Qwen3.5 (2B) Vision notebook as it
stood on 2026-11-03. If a step fails, its command is printed above the
error.

Pure ASCII, like scripts/model/render.py, for the PowerShell 5.1 reason in
CLAUDE.md.
"""

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

WORK = '/kaggle/working'
BASE_MODEL = 'unsloth/Qwen3.5-2B'
DRAW_VARIANTS = 2  # set by --draw-variants
BOXES = False  # set by --boxes: the boxes design, each row carrying its own prompt
INSTRUCTION = ('This is one page of a printed business report. Write its structure as Forma skeleton text: '
               'the page line, then each band and the controls in it, one per line.')


def prompt_of(row):
    """The question asked of a page: its own, with the text boxes, in the boxes design; else the one instruction."""
    return row.get('prompt') or INSTRUCTION


def sh(cmd, optional=False):
    print('+ ' + cmd, flush=True)
    code = subprocess.call(cmd, shell=True)
    if code and not optional:
        sys.exit('Failed (exit %d): %s' % (code, cmd))


def setup():
    """Unsloth's notebook installs, on an image that already has torch (Kaggle's does)."""
    sh('pip install --upgrade -qqq uv')
    sh('uv pip install --system -qqq unsloth')
    sh('uv pip install --system -qqq --upgrade --no-deps "tokenizers>=0.22.0,<=0.23.0" "trl==0.22.2" unsloth unsloth_zoo')
    sh('uv pip install --system -qqq "transformers==5.2.0"')
    sh('unsloth install-kernels', optional=True)
    sh('uv pip install --system -qqq --no-deps --upgrade "torchao>=0.16.0"')
    print('Setup done. Next: python train_vision.py --smoke')


def dataset_dir():
    """
    The folder holding train.jsonl and the page images. The dataset may hold
    them already, drawn on the owner's machine; or a zip of them; or only
    examples.jsonl, the skeletons, which are then drawn here with the same
    render.py and Liberation faces, fetched from the public repository. Drawn
    pages go to /tmp, so a saved version's output is not filled with 60 MB of
    pictures.
    """
    hits = glob.glob('/kaggle/input/**/train.jsonl', recursive=True)
    if hits:
        return os.path.dirname(hits[0])
    out = '/tmp/forma-data'
    if os.path.exists(os.path.join(out, 'train.jsonl')):
        return out
    zips = glob.glob('/kaggle/input/**/*.zip', recursive=True)
    if zips:
        print('Unzipping %s' % zips[0], flush=True)
        with zipfile.ZipFile(zips[0]) as z:
            z.extractall(out)
        if os.path.exists(os.path.join(out, 'train.jsonl')):
            return out
    examples = glob.glob('/kaggle/input/**/examples.jsonl', recursive=True) + glob.glob(os.path.join(out, 'examples.jsonl'))
    if examples:
        os.makedirs(out, exist_ok=True)
        if os.path.abspath(examples[0]) != os.path.abspath(os.path.join(out, 'examples.jsonl')):
            shutil.copy(examples[0], os.path.join(out, 'examples.jsonl'))
        repo = '/tmp/forma'
        if not os.path.isdir(repo):
            sh('git clone -q --depth 1 https://github.com/waqarsyd/forma %s' % repo)
        sh('python %s/scripts/model/render.py %s --variants %d%s' % (repo, out, DRAW_VARIANTS, ' --boxes' if BOXES else ''))
        return out
    sys.exit('No examples.jsonl or train.jsonl under /kaggle/input. Add the "Forma report skeletons" dataset as input.')


def rows(split, max_chars, limit=0):
    d = dataset_dir()
    with open(os.path.join(d, split + '.jsonl'), encoding='utf-8') as fh:
        out = [json.loads(line) for line in fh if line.strip()]
    # The boxes design's question holds every box on the page, so it counts too.
    kept = [r for r in out if len(r.get('prompt', '')) + len(r['target']) <= max_chars]
    if len(kept) < len(out):
        print('%s: left out %d of %d pages whose text is over %d characters' % (split, len(out) - len(kept), len(out), max_chars))
    if limit:
        kept = kept[:limit]
    for r in kept:
        r['path'] = os.path.join(d, r['image'])
    return kept


def one_gpu():
    """Use one T4 even when the accelerator is "T4 x2": two need accelerate, and one is enough for 2B."""
    os.environ.setdefault('CUDA_VISIBLE_DEVICES', '0')
    import torch
    if not torch.cuda.is_available():
        sys.exit('No GPU. In the notebook settings choose Accelerator: GPU T4 x2, then restart.')
    cap = torch.cuda.get_device_capability(0)
    name = torch.cuda.get_device_name(0)
    if cap < (7, 0):
        sys.exit('%s has compute capability %d.%d; Unsloth needs 7.0. Choose GPU T4 x2, not P100.' % (name, cap[0], cap[1]))
    print('GPU: %s' % name, flush=True)


def conversation(row, image):
    return {'messages': [
        {'role': 'user', 'content': [{'type': 'image', 'image': image}, {'type': 'text', 'text': prompt_of(row)}]},
        {'role': 'assistant', 'content': [{'type': 'text', 'text': row['target']}]},
    ]}


def load_image(path):
    from PIL import Image
    return Image.open(path).convert('RGB')


def loop_guard(tokenizer, start, window=16, distinct=2, every=16):
    """
    Stop an answer that has fallen into a loop: its last `window` complete
    lines hold `distinct` different lines or fewer. Version 3 (2026-11-04)
    looped on all 40 held-out pages, one line repeated from about line 10 to
    the token limit, and spent 3.5 of its 5.3 GPU hours writing them. A
    boxes answer never repeats a line, and a skeleton rarely repeats one
    sixteen times. Looked at every `every` tokens, so it costs little.
    """
    import torch
    from transformers import StoppingCriteria

    class LoopGuard(StoppingCriteria):
        def __init__(self):
            self.steps = 0
            self.fired = False

        def __call__(self, input_ids, scores, **kwargs):
            self.steps += 1
            if self.steps % every == 0 and not self.fired:
                lines = tokenizer.decode(input_ids[0][start:], skip_special_tokens=True).split('\n')[:-1]
                tail = [l.strip() for l in lines[-window:]]
                self.fired = len(tail) >= window and len(set(tail)) <= distinct
            return torch.full((input_ids.shape[0],), self.fired, dtype=torch.bool, device=input_ids.device)

    return LoopGuard()


def predict(model, tokenizer, pages, max_new_tokens, out_path):
    from unsloth import FastVisionModel
    from transformers import StoppingCriteriaList
    FastVisionModel.for_inference(model)
    looped = 0
    with open(out_path, 'w', encoding='utf-8', newline='\n') as fh:
        for i, r in enumerate(pages):
            messages = [{'role': 'user', 'content': [{'type': 'image'}, {'type': 'text', 'text': prompt_of(r)}]}]
            prompt = tokenizer.apply_chat_template(messages, add_generation_prompt=True)
            inputs = tokenizer(load_image(r['path']), prompt, add_special_tokens=False, return_tensors='pt').to('cuda')
            guard = loop_guard(tokenizer, inputs['input_ids'].shape[1])
            out = model.generate(**inputs, max_new_tokens=max_new_tokens, use_cache=True, do_sample=False,
                                 stopping_criteria=StoppingCriteriaList([guard]))
            text = tokenizer.decode(out[0][inputs['input_ids'].shape[1]:], skip_special_tokens=True)
            text = re.sub(r'<think>.*?</think>', '', text, flags=re.S).strip()
            looped += guard.fired
            # The boxes design keeps the prompt and the skeleton, which scoring on the page needs.
            extra = {k: r[k] for k in ('prompt', 'truth') if k in r}
            if guard.fired:
                extra['stopped'] = 'loop'
            fh.write(json.dumps(dict({'id': r['id'], 'image': r['image'], 'target': r['target'], 'prediction': text}, **extra)) + '\n')
            fh.flush()
            print('predicted %d/%d (%s): %d lines, the right answer has %d' % (
                i + 1, len(pages), r['image'], len(text.splitlines()), len(r['target'].splitlines())), flush=True)
            if i == 0:
                print('\n'.join(text.splitlines()[:8]), flush=True)
    print('%s: %d of %d answers stopped looping' % (os.path.basename(out_path), looped, len(pages)), flush=True)


def ocr_rows(max_chars):
    """
    The held-out pages asked with OCR's boxes instead of the drawn ones, for
    the boxes design: eval-ocr.jsonl, written on the owner's machine by
    `scripts/model/evaluate.ts --ocr-prompts` from the same pages read by the
    app's own OCR. Each row names a page image the dataset draws here. None
    when the dataset holds no such file.
    """
    hits = glob.glob('/kaggle/input/**/eval-ocr.jsonl', recursive=True)
    if not hits:
        return []
    d = dataset_dir()
    with open(hits[0], encoding='utf-8') as fh:
        out = [json.loads(line) for line in fh if line.strip()]
    kept = [r for r in out if len(r['prompt']) <= max_chars and os.path.exists(os.path.join(d, r['image']))]
    for r in kept:
        r['path'] = os.path.join(d, r['image'])
    print('eval-ocr: %d of %d pages asked with OCR boxes' % (len(kept), len(out)), flush=True)
    return kept


def train(args, smoke):
    one_gpu()
    from unsloth import FastVisionModel, is_bf16_supported
    from unsloth.trainer import UnslothVisionDataCollator
    from trl import SFTConfig, SFTTrainer

    train_rows = rows('train', args.max_chars, limit=40 if smoke else 0)
    eval_rows = [r for r in rows('eval', args.max_chars) if r['image'].endswith('-0.png')]
    eval_rows = eval_rows[:3 if smoke else args.predict]
    print('training on %d page images, predicting %d held-out pages' % (len(train_rows), len(eval_rows)), flush=True)

    model, tokenizer = FastVisionModel.from_pretrained(BASE_MODEL, load_in_4bit=False, use_gradient_checkpointing='unsloth')
    model = FastVisionModel.get_peft_model(
        model, finetune_vision_layers=True, finetune_language_layers=True, finetune_attention_modules=True,
        finetune_mlp_modules=True, r=16, lora_alpha=16, lora_dropout=0, bias='none', random_state=3407,
        use_rslora=False, loftq_config=None)

    data = [conversation(r, load_image(r['path'])) for r in train_rows]
    FastVisionModel.for_training(model)
    bf16 = is_bf16_supported()
    config = SFTConfig(
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        warmup_steps=5,
        max_steps=20 if smoke else -1,
        num_train_epochs=args.epochs,
        learning_rate=2e-4,
        logging_steps=1 if smoke else 10,
        optim='adamw_8bit',
        weight_decay=0.001,
        lr_scheduler_type='linear',
        seed=3407,
        output_dir=os.path.join(WORK, 'outputs'),
        save_strategy='no' if smoke else 'steps',
        save_steps=100,
        save_total_limit=1,
        report_to='none',
        fp16=not bf16,
        bf16=bf16,
        remove_unused_columns=False,
        dataset_text_field='',
        dataset_kwargs={'skip_prepare_dataset': True},
        max_length=args.max_length,
    )
    trainer = SFTTrainer(model=model, tokenizer=tokenizer, data_collator=UnslothVisionDataCollator(model, tokenizer),
                         train_dataset=data, args=config)
    stats = trainer.train()
    print('trained: %s' % stats.metrics, flush=True)

    lora = os.path.join(WORK, 'lora')
    model.save_pretrained(lora)
    tokenizer.save_pretrained(lora)
    print('adapter saved to %s' % lora, flush=True)
    predict(model, tokenizer, eval_rows, args.max_new_tokens, os.path.join(WORK, 'predictions.jsonl'))
    if BOXES:
        # The same pages with OCR's boxes: what Forma will really ask.
        ocr = ocr_rows(args.max_chars)
        if ocr:
            predict(model, tokenizer, ocr[:3 if smoke else len(ocr)], args.max_new_tokens, os.path.join(WORK, 'predictions-ocr.jsonl'))
    print('Done. predictions.jsonl holds the answers.' + (' Next: --train.' if smoke else ' Next: --export.'))


def merged_model():
    """
    The merged 16-bit model: one a saved version already wrote, added as
    input, which a CPU session can convert without spending GPU hours; or
    one merged here from the adapter, which needs the GPU.
    """
    for config in [os.path.join(WORK, 'merged', 'config.json')] + glob.glob('/kaggle/input/**/merged/config.json', recursive=True):
        if os.path.exists(config):
            return os.path.dirname(config), False
    lora = next((os.path.dirname(c) for c in [os.path.join(WORK, 'lora', 'adapter_config.json')] +
                 glob.glob('/kaggle/input/**/lora/adapter_config.json', recursive=True) if os.path.exists(c)), None)
    if not lora:
        sys.exit('No merged model and no adapter. Run --train first, or add the version that ran it as input.')
    one_gpu()
    from unsloth import FastVisionModel
    model, tokenizer = FastVisionModel.from_pretrained(lora, load_in_4bit=False)
    merged = os.path.join(WORK, 'merged')
    model.save_pretrained_merged(merged, tokenizer)
    return merged, True


def export(args):
    merged, made_here = merged_model()

    # Convert with llama.cpp's own scripts: a direct quantized export from Unsloth garbled
    # a Qwen-VL model's output (unsloth #3899), while F16 then llama-quantize did not.
    # Install only its gguf package. Its requirements file pins an older transformers,
    # which cannot read what transformers 5.2 saved: Version 1 (2026-11-03) failed with
    # "Tokenizer class TokenizersBackend does not exist" after installing it.
    llama = '/tmp/llama.cpp'
    if not os.path.isdir(llama):
        sh('git clone -q --depth 1 https://github.com/ggml-org/llama.cpp %s' % llama)
    sh('pip install -qqq --no-deps %s/gguf-py' % llama)
    code = subprocess.call([sys.executable, '-c', 'import sys, transformers; sys.exit(0 if transformers.__version__.startswith("5") else 1)'])
    if code:
        sh('pip install -qqq "transformers==5.2.0" "tokenizers>=0.22.0,<=0.23.0"')
    gguf = os.path.join(WORK, 'gguf')
    os.makedirs(gguf, exist_ok=True)
    f16 = os.path.join(gguf, 'forma-vision-f16.gguf')
    sh('python %s/convert_hf_to_gguf.py %s --outtype f16 --outfile %s' % (llama, merged, f16))
    # The projector's name must say mmproj: LM Studio pairs it with the model by
    # that word, and with --outfile the converter writes exactly the name given
    # (the first CPU export, 2026-11-03, wrote "forma-vision.gguf").
    sh('python %s/convert_hf_to_gguf.py %s --mmproj --outtype f16 --outfile %s' % (
        llama, merged, os.path.join(gguf, 'mmproj-forma-vision-f16.gguf')))
    sh('cmake -S %s -B %s/build -DGGML_CUDA=OFF -DLLAMA_CURL=OFF > /dev/null' % (llama, llama))
    sh('cmake --build %s/build --target llama-quantize -j 4 > /dev/null' % llama)
    q8 = os.path.join(gguf, 'forma-vision-Q8_0.gguf')
    sh('%s/build/bin/llama-quantize %s %s Q8_0' % (llama, f16, q8))
    if not args.keep:
        os.remove(f16)
        if made_here:
            sh('rm -rf %s' % merged)
    for p in sorted(glob.glob(os.path.join(gguf, '*.gguf'))):
        print('%8.0f MB  %s' % (os.path.getsize(p) / 1e6, p))
    print('Download the Q8_0 model and the mmproj file from this version\'s Output tab.')


def find_gguf():
    """The exported model and its projector, from this session or from a version added as input."""
    files = glob.glob(os.path.join(WORK, 'gguf', '*.gguf')) + glob.glob('/kaggle/input/**/gguf/*.gguf', recursive=True)
    model = next((f for f in files if f.endswith('Q8_0.gguf')), None)
    # mmproj-*.gguf, or forma-vision.gguf as the first export named it.
    mmproj = next((f for f in files if 'mmproj' in os.path.basename(f)), None) or \
        next((f for f in files if os.path.basename(f) == 'forma-vision.gguf'), None)
    return model, mmproj


def check(args):
    """
    Run the exported model as users will, on this machine's CPU, so a CPU-only
    session can do it without spending GPU hours:
    - llama.cpp's multimodal CLI, the engine LM Studio runs;
    - Ollama, importing the model and its projector, then asked through its
      OpenAI-compatible endpoint exactly as Forma asks (services/formaVision.ts).
    Writes check.txt and prints what each answered.
    """
    import base64
    import time
    import urllib.request

    model, mmproj = find_gguf()
    if not (model and mmproj):
        sys.exit('No forma-vision-Q8_0.gguf and mmproj under /kaggle/working/gguf or /kaggle/input. '
                 'Add the version that ran --export as input.')
    pages = [r for r in rows('eval', args.max_chars) if r['image'].endswith('-0.png')][:2]
    report = ['model: %s' % model, 'projector: %s' % mmproj]

    llama = '/tmp/llama.cpp'
    if not os.path.isdir(llama):
        sh('git clone -q --depth 1 https://github.com/ggml-org/llama.cpp %s' % llama)
    sh('cmake -S %s -B %s/build -DGGML_CUDA=OFF -DLLAMA_CURL=OFF > /dev/null' % (llama, llama))
    sh('cmake --build %s/build --target llama-mtmd-cli -j 4 > /dev/null' % llama)
    for r in pages:
        out = subprocess.run([os.path.join(llama, 'build', 'bin', 'llama-mtmd-cli'), '-m', model, '--mmproj', mmproj,
                              '--image', r['path'], '-p', prompt_of(r), '-n', str(args.check_tokens), '--temp', '0'],
                             capture_output=True, text=True)
        answer = out.stdout.strip()
        first = next((l for l in answer.splitlines() if l.startswith('page ')), '')
        report.append('llama.cpp %s: %s, %d lines, first: %s' % (
            r['image'], 'ANSWERED' if first else 'NO PAGE LINE (exit %d)' % out.returncode, len(answer.splitlines()), first or out.stderr[-300:]))

    sh('apt-get install -y -qq zstd > /dev/null', optional=True)
    sh('curl -fsSL https://ollama.com/install.sh | sh > /tmp/ollama-install.log 2>&1', optional=True)
    server = subprocess.Popen(['ollama', 'serve'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(30):
            try:
                urllib.request.urlopen('http://127.0.0.1:11434/api/version', timeout=2)
                break
            except Exception:
                time.sleep(1)
        # Ollama needs the chat template of the model's family. With none, the
        # first check (2026-11-03) imported the model with vision listed and got
        # empty answers. The template, renderer and parameters are copied from
        # Ollama's own qwen3.5:2b, as Unsloth's guide says to.
        #
        # Its PARSER is not (2026-11-04). With it, the second check got empty
        # `content` and the whole answer in `reasoning`: the qwen3.5 parser
        # treats what the model writes as thinking until a closing tag, and a
        # model fine-tuned on page lines never writes one. The renderer stays,
        # because the copied TEMPLATE alone may be a bare `{{ .Prompt }}` with
        # the chat format in the renderer. `forma-vision` is the fix, asked as
        # Forma asks. `forma-vision-parsed` keeps the parser and is asked with
        # thinking off, the other way out, on one page, so one run says which
        # works.
        sh('ollama pull qwen3.5:2b > /dev/null 2>&1', optional=True)
        base = subprocess.run(['ollama', 'show', '--modelfile', 'qwen3.5:2b'], capture_output=True, text=True).stdout
        kept, block = [], None
        for line in base.splitlines():
            if block is not None:
                block.append(line)
                if line.rstrip().endswith('"""'):
                    kept.extend(block)
                    block = None
                continue
            word = line.split(' ', 1)[0]
            if word == 'TEMPLATE' and line.count('"""') == 1:
                block = [line]
            elif word in ('TEMPLATE', 'PARAMETER', 'RENDERER', 'PARSER'):
                kept.append(line)
        words = [l.split(' ', 1)[0] for l in kept if l.split(' ', 1)[0] in ('TEMPLATE', 'PARAMETER', 'RENDERER', 'PARSER')]
        report.append('copied from qwen3.5:2b: %d lines (%s)' % (len(kept), ', '.join(words)))

        def create(name, lines):
            with open('/tmp/Modelfile', 'w') as fh:
                fh.write('FROM %s\nFROM %s\n%s\nPARAMETER temperature 0\n' % (model, mmproj, '\n'.join(lines)))
            made = subprocess.run(['ollama', 'create', name, '-f', '/tmp/Modelfile'], capture_output=True, text=True)
            shown = subprocess.run(['ollama', 'show', name], capture_output=True, text=True).stdout.lower()
            report.append('ollama create %s: %s; vision: %s; thinking: %s' % (
                name, 'OK' if made.returncode == 0 else 'FAILED: ' + (made.stderr or made.stdout)[-300:],
                'vision' in shown, 'thinking' in shown))
            return made.returncode == 0

        def ask(label, r, path, body):
            req = urllib.request.Request('http://127.0.0.1:11434' + path, data=json.dumps(body).encode('utf-8'),
                                         headers={'Content-Type': 'application/json'})
            try:
                reply = json.load(urllib.request.urlopen(req, timeout=900))
                if 'choices' in reply:
                    message, finish = reply['choices'][0]['message'], reply['choices'][0].get('finish_reason')
                else:
                    message, finish = reply.get('message', {}), reply.get('done_reason')
                answer = message.get('content') or ''
                first = next((l for l in answer.splitlines() if l.startswith('page ')), '')
                # An empty answer says nothing; what the reply did hold says why.
                seen = '' if first else ' (finish %s; message keys %s; reasoning starts %r)' % (
                    finish, sorted(message.keys()),
                    (message.get('reasoning') or message.get('reasoning_content') or message.get('thinking') or '')[:120])
                report.append('%s %s: %s, %d lines, first: %s%s' % (
                    label, r['image'], 'ANSWERED' if first else 'NO PAGE LINE', len(answer.splitlines()), first or answer[:200], seen))
            except Exception as err:
                report.append('%s %s: FAILED: %s' % (label, r['image'], err))

        def image_of(r):
            with open(r['path'], 'rb') as fh:
                return base64.b64encode(fh.read()).decode('ascii')

        def as_forma(name, r, **extra):
            body = {'model': name, 'temperature': 0, 'max_tokens': args.check_tokens, 'messages': [
                {'role': 'user', 'content': [{'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + image_of(r)}},
                                             {'type': 'text', 'text': prompt_of(r)}]}]}
            body.update(extra)
            return body

        if create('forma-vision', [l for l in kept if not l.startswith('PARSER')]):
            for r in pages:
                ask('ollama (as Forma asks)', r, '/v1/chat/completions', as_forma('forma-vision', r))
        if any(l.startswith('PARSER') for l in kept) and create('forma-vision-parsed', kept):
            r = pages[0]
            ask('ollama with its parser, reasoning_effort none', r, '/v1/chat/completions',
                as_forma('forma-vision-parsed', r, reasoning_effort='none'))
            ask('ollama with its parser, native think false', r, '/api/chat', {
                'model': 'forma-vision-parsed', 'stream': False, 'think': False,
                'options': {'temperature': 0, 'num_predict': args.check_tokens},
                'messages': [{'role': 'user', 'content': prompt_of(r), 'images': [image_of(r)]}]})
    finally:
        server.terminate()

    with open(os.path.join(WORK, 'check.txt'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(report) + '\n')
    print('\n'.join(report))


def main():
    ap = argparse.ArgumentParser(description="Fine-tune Forma's vision model on Kaggle.")
    ap.add_argument('--setup', action='store_true', help='install Unsloth (once per session)')
    ap.add_argument('--smoke', action='store_true', help='a short run that proves every step works')
    ap.add_argument('--train', action='store_true', help='the full run')
    ap.add_argument('--export', action='store_true', help='GGUF and vision projector from the adapter')
    ap.add_argument('--epochs', type=float, default=1)
    ap.add_argument('--max-length', type=int, default=6144, help='tokens per example, image included')
    ap.add_argument('--max-chars', type=int, default=8000, help='pages whose text is longer are left out')
    ap.add_argument('--max-new-tokens', type=int, default=4096)
    ap.add_argument('--predict', type=int, default=10, help='held-out pages to answer after the full run')
    ap.add_argument('--keep', action='store_true', help='keep the merged model and the F16 GGUF')
    ap.add_argument('--merge', action='store_true', help='merge the adapter into the model (GPU), for a CPU session to export')
    ap.add_argument('--check', action='store_true', help='run the exported model in llama.cpp and Ollama, on the CPU')
    ap.add_argument('--check-tokens', type=int, default=1500, help='how much each check answer may write')
    ap.add_argument('--draw-variants', type=int, default=2, help='pictures drawn of each skeleton when the dataset holds skeletons only')
    ap.add_argument('--boxes', action='store_true', help='the boxes design (2026-11-04): pages drawn with their text boxes, each row its own prompt')
    args = ap.parse_args()
    global DRAW_VARIANTS, BOXES
    DRAW_VARIANTS = args.draw_variants
    BOXES = args.boxes
    if args.setup:
        setup()
    if args.smoke or args.train:
        train(args, smoke=args.smoke)
    if args.merge:
        merged_model()
    if args.export:
        export(args)
    if args.check:
        check(args)
    if not (args.setup or args.smoke or args.train or args.merge or args.export or args.check):
        ap.print_help()


if __name__ == '__main__':
    main()
