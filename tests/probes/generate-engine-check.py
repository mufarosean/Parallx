"""Generate's engine, checked without the graphics card or the model.

    python tests/probes/generate-engine-check.py

Part 1 needs numpy and Pillow: the arithmetic in ext/media-organizer/engine/
generate_patch.py, on pictures made here (a detailed "photo", and stand-ins
for what the model answers).

Part 2 also needs torch, diffusers 0.43.0 and transformers 5.22.2 (the
versions the runtime pins; the processor is enough, no card): it runs
engine/generate.py's own edit, through the real Qwen-Image-2.1 pipeline code,
on a model of the same shape with a few thousand random weights (the one
diffusers tests the pipeline with). A random model paints nonsense, so what
is checked is the mechanics: the photo is read at the size the answer is
made at, what is outside the mark comes back as the photo, the instruction
is written out by the reader, and the patch lands where the mark is. Part 2
is skipped, and says so, when those packages are missing.

Prints one line per check and ends with the number of problems.
"""

import json
import os
import sys
import tempfile

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'ext', 'media-organizer', 'engine'))
import generate_patch as gp  # noqa: E402

problems = 0


def check(name, ok, detail=''):
    global problems
    if not ok:
        problems += 1
    print(('ok    ' if ok else 'WRONG ') + name + (f'  ({detail})' if detail else ''))


def psnr(a, b):
    mse = float(((np.asarray(a, dtype=np.float32) - np.asarray(b, dtype=np.float32)) ** 2).mean())
    return 99.0 if mse == 0 else 10 * np.log10(255 ** 2 / mse)


def photo(w, h, seed=1):
    """A picture with detail at every scale down to the pixel, and grain."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w, 3), dtype=np.float32)
    for scale, weight in ((64, 60), (16, 40), (4, 30), (1, 22)):
        layer = rng.random((h // scale + 2, w // scale + 2, 3)).astype(np.float32)
        layer = np.asarray(Image.fromarray((layer * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), dtype=np.float32) / 255
        out += (layer - 0.5) * weight
    return Image.fromarray(np.clip(out + 128, 0, 255).astype(np.uint8), 'RGB')


def as_the_model_returns(img, seed=3):
    """What a round trip through a model does to a picture it leaves alone: a little softer, a little noise."""
    rng = np.random.default_rng(seed)
    a = np.asarray(img, dtype=np.float32)
    a = 0.7 * a + 0.3 * np.dstack([gp.blur(a[..., c], 1) for c in range(3)])
    return Image.fromarray(np.clip(a + rng.normal(0, 1.5, a.shape), 0, 255).astype(np.uint8), 'RGB')


def part_one():
    print('Part 1: the arithmetic')
    # sizes
    for w, h in ((1590, 1110), (8687, 2416), (4000, 4000), (300, 200), (6960, 4640), (9504, 6336)):
        mw, mh = gp.model_size(w, h)
        ok = mw % 32 == 0 and mh % 32 == 0 and max(mw, mh) <= gp.MAX_SIDE and mw * mh <= gp.MAX_PIXELS * 1.03
        check(f'the model works at {mw} x {mh} for {w} x {h}', ok)
        check('  and reads the photo at that size', gp.reads_at(mw, mh, (mw * mh) ** 0.5) == (mw, mh))
    check('a small area is enlarged', max(gp.model_size(300, 200)) == gp.MIN_SIDE)
    check('the area shown is the mark and half as much again each side', gp.cut_out_box((1000, 1000, 1600, 1400), (8000, 6000)) == (700, 744, 1900, 1656))
    check('a band across the picture gets only what borders it', gp.cut_out_box((0, 0, 8687, 1790), (8687, 3647)) == (0, 0, 8687, 2416))

    # growth and blur
    m = np.zeros((40, 40), bool)
    m[20, 20] = True
    g = gp.grow(m, 3)
    check('growing spreads a mark the same way each side', g[17:24, 17:24].all() and g.sum() == 49)
    flat = np.full((30, 50), 7.0, np.float32)
    check('a blur leaves a flat picture as it is', np.allclose(gp.blur(flat, 5), 7.0, atol=1e-3))

    # where the model may work, and the patch's edge
    mark_small = np.zeros((512, 768), bool)
    mark_small[200:300, 300:420] = True
    free = gp.free_tiles(mark_small)
    check('the model is free on the marked tiles and one tile round them', free.shape == (32, 48) and free[11:20, 17:28].all() and free.sum() == 9 * 11, f'{int(free.sum())} tiles')
    alpha = gp.patch_alpha(mark_small)
    check('inside the mark the patch is all answer', float(alpha[mark_small].min()) >= 0.999)
    far = ~gp.grow(mark_small, 30)
    check('and it is gone 30 pixels out', float(alpha[far].max()) <= 0.002, f'{float(alpha[far].max()):.4f}')
    inside_free = np.repeat(np.repeat(free, 16, 0), 16, 1)
    check('it fades inside what the model was free to join', float(alpha[~inside_free].max()) <= 0.5, f'{float(alpha[~inside_free].max()):.2f} at most where the photo was held')

    # the patch, at the photo's own pixels
    W, H = 3072, 2048
    cut = photo(W, H)
    small = cut.resize((1536, 1024), Image.LANCZOS)
    mark = Image.new('L', (W, H), 0)
    mark.paste(255, (1000, 600, 2000, 1400))
    mark_s = np.asarray(mark.resize(small.size, Image.BILINEAR)) >= 64
    returned = as_the_model_returns(small)

    # 1. the model changed nothing: the patch must be the photo, at full sharpness
    patch, box, new = gp.make_patch(cut, small, returned, mark, mark_s)
    p = np.asarray(patch)
    region = np.asarray(cut.crop(box))
    plain = np.asarray(returned.resize((W, H), Image.BICUBIC).crop(box))
    inside = p[..., 3] == 255
    with_detail, without = psnr(p[..., :3][inside], region[inside]), psnr(plain[inside], region[inside])
    check('an answer that changed nothing gives back the photo, sharp', with_detail > without + 6 and with_detail > 30, f'{with_detail:.1f} dB against the photo; the answer just enlarged is {without:.1f} dB')
    check('  and it is counted as nothing new', new < 0.1, f'{new:.2f} of the mark')
    check('the patch is cropped to the mark and its edge', box[0] >= 930 and box[1] >= 530 and box[2] <= 2070 and box[3] <= 1470, str(box))

    # 1b. made against the photo as the coder returns it, the same answer gives back the photo itself
    patch, box, new = gp.make_patch(cut, returned, returned, mark, mark_s)
    p = np.asarray(patch)
    inside = p[..., 3] == 255
    exact = psnr(p[..., :3][inside], np.asarray(cut.crop(box))[inside])
    check('made against what the coder returns, an unchanged answer is the photo itself', exact > 50, f'{exact:.1f} dB against the photo')

    # 2. the model darkened the light and changed nothing else: detail still comes back, darker
    darker = Image.fromarray((np.asarray(returned, dtype=np.float32) * 0.6).astype(np.uint8), 'RGB')
    patch, box, new = gp.make_patch(cut, small, darker, mark, mark_s)
    p = np.asarray(patch)
    want = np.asarray(cut.crop(box), dtype=np.float32) * 0.6
    plain = np.asarray(darker.resize((W, H), Image.BICUBIC).crop(box))
    inside = p[..., 3] == 255
    with_detail, without = psnr(p[..., :3][inside], want[inside]), psnr(plain[inside], want[inside])
    check('a change of light keeps the photo\'s detail', with_detail > without + 4, f'{with_detail:.1f} dB against the photo darkened; enlarged alone {without:.1f} dB')

    # 3. the model put something else there: none of the old picture's detail may be laid over it
    other = np.asarray(returned).copy()
    new_thing = np.asarray(photo(1536, 1024, seed=9))
    other[320:680, 520:980] = new_thing[320:680, 520:980]
    other = Image.fromarray(other, 'RGB')
    patch, box, new = gp.make_patch(cut, small, other, mark, mark_s)
    p = np.asarray(patch)[..., :3]
    plain = np.asarray(other.resize((W, H), Image.BICUBIC).crop(box))
    core = (slice(700 - box[1], 1300 - box[1]), slice(1100 - box[0], 1900 - box[0]))
    check('something new is laid in as the answer has it, no old detail over it', psnr(p[core], plain[core]) > 32, f'{psnr(p[core], plain[core]):.1f} dB against the answer enlarged')
    check('  and it is counted as new', new > 0.5, f'{new:.2f} of the mark')

    # 4. a flat area that stays flat keeps its grain
    rng = np.random.default_rng(5)
    sky = Image.fromarray(np.clip(np.full((H, W, 3), (120, 150, 200), np.float32) + rng.normal(0, 4, (H, W, 3)), 0, 255).astype(np.uint8), 'RGB')
    sky_small = sky.resize((1536, 1024), Image.LANCZOS)
    warm = Image.fromarray(np.clip(np.asarray(sky_small, dtype=np.float32) * (1.2, 0.9, 0.6), 0, 255).astype(np.uint8), 'RGB')
    patch, box, new = gp.make_patch(sky, sky_small, warm, mark, mark_s)
    p = np.asarray(patch, dtype=np.float32)[200:600, 200:800, 1]
    grain = float((p - gp.blur(p, 2)).std())
    was = np.asarray(sky, dtype=np.float32)[800:1200, 1200:1800, 1]
    check('a sky given a new colour keeps the photo\'s grain', grain > 0.5 * float((was - gp.blur(was, 2)).std()), f'grain {grain:.1f} against {float((was - gp.blur(was, 2)).std()):.1f} in the photo')

    # 5. strips: a patch made in strips is the patch made in one piece
    old = gp.STRIP
    whole_mark = Image.new('L', (W, H), 255)
    whole_s = np.ones((1024, 1536), bool)
    gp.STRIP = 100000
    one, _, _ = gp.make_patch(cut, small, darker, whole_mark, whole_s)
    gp.STRIP = 300
    many, box, _ = gp.make_patch(cut, small, darker, whole_mark, whole_s)
    gp.STRIP = old
    worst = int(np.abs(np.asarray(one, dtype=np.int16) - np.asarray(many, dtype=np.int16)).max())
    check('the whole picture as a patch is the whole picture, with no seams between strips', box == (0, 0, W, H) and worst <= 1, f'largest difference {worst} of 255')

    # the held part, and the outline
    free = gp.free_tiles(mark_s)
    check('the held part of an unchanged answer reads as held', gp.held_db(small, returned, free) > 30, f'{gp.held_db(small, returned, free):.1f} dB')
    shifted = Image.fromarray(np.roll(np.asarray(returned), 12, axis=1), 'RGB')
    check('and an answer out of step with the photo does not', gp.held_db(small, shifted, free) < 24, f'{gp.held_db(small, shifted, free):.1f} dB')
    line = np.asarray(gp.outlined(small, mark_s))
    magenta = (line[..., 0] > 250) & (line[..., 1] < 5) & (line[..., 2] > 250)
    check('the mark\'s edge is drawn for the reader, round the mark and not over it', 500 < int(magenta.sum()) < 20000 and line.shape[1] == 1024 and not magenta[300:340, 400:560].any())


def part_two():
    print('Part 2: the real pipeline code, on a model of a few thousand random weights')
    try:
        import torch
        import diffusers
        from diffusers import AutoencoderKLQwenImage21, FlowMatchEulerDiscreteScheduler, QwenImage21Pipeline, QwenImage21Transformer2DModel
        from transformers import AutoTokenizer, Qwen2VLImageProcessor, Qwen3VLConfig, Qwen3VLForConditionalGeneration, Qwen3VLProcessor, Qwen3VLVideoProcessor
    except Exception as e:
        print(f'skipped: {type(e).__name__}: {e}')
        return
    import generate
    print(f'diffusers {diffusers.__version__}, torch {torch.__version__}')

    # The tiny model diffusers tests this pipeline with (tests/pipelines/qwenimage21/test_qwenimage21.py, v0.43.0).
    z, hidden = 8, 16
    torch.manual_seed(0)
    transformer = QwenImage21Transformer2DModel(patch_size=1, in_channels=z, out_channels=z, num_layers=2, attention_head_dim=16,
                                                num_attention_heads=2, context_in_dim=hidden, mlp_ratio=2, axes_dims_rope=(4, 6, 6))
    vae = AutoencoderKLQwenImage21(base_dim=4, decoder_base_dim=4, z_dim=z, dim_mult=[1, 1, 1, 1, 1], num_res_blocks=1, attn_scales=[],
                                   temperal_downsample=[False, True, True, True], latents_mean=[0.0] * z, latents_std=[1.0] * z)
    config = Qwen3VLConfig(
        text_config={'hidden_size': hidden, 'intermediate_size': 16, 'num_hidden_layers': 2, 'num_attention_heads': 2, 'num_key_value_heads': 2,
                     'head_dim': 8, 'rope_parameters': {'rope_type': 'default', 'rope_theta': 1000000.0, 'mrope_section': [1, 1, 2]}},
        vision_config={'depth': 2, 'hidden_size': 16, 'intermediate_size': 16, 'num_heads': 2, 'out_hidden_size': hidden, 'patch_size': 16,
                       'spatial_merge_size': 2, 'temporal_patch_size': 2, 'num_position_embeddings': 64, 'deepstack_visual_indexes': [0]})
    reader = Qwen3VLForConditionalGeneration(config).eval()
    try:
        tokenizer = AutoTokenizer.from_pretrained('hf-internal-testing/tiny-random-Qwen2VLForConditionalGeneration')
    except Exception as e:
        print(f'skipped: the tiny tokenizer could not be fetched ({type(e).__name__})')
        return
    processor = Qwen3VLProcessor(image_processor=Qwen2VLImageProcessor(patch_size=16, merge_size=2, temporal_patch_size=2, min_pixels=32 * 32, max_pixels=1024 * 1024),
                                 tokenizer=tokenizer, video_processor=Qwen3VLVideoProcessor(patch_size=16, merge_size=2, temporal_patch_size=2), chat_template=tokenizer.chat_template)
    pipe = QwenImage21Pipeline(scheduler=FlowMatchEulerDiscreteScheduler(), vae=vae, text_encoder=reader, processor=processor, transformer=transformer)
    pipe.set_progress_bar_config(disable=True)

    # The model's limits brought down to a size a processor does in seconds; the arithmetic is the same.
    gp.MAX_SIDE, gp.MAX_PIXELS, gp.MIN_SIDE = 320, 320 * 256, 256
    cut = photo(640, 512, seed=4)
    mark = Image.new('L', cut.size, 0)
    mark.paste(255, (260, 200, 400, 320))
    work = tempfile.mkdtemp(prefix='generate-check-')

    sizes = []
    prepare = pipe.prepare_latents

    def watching(images, *a, **k):
        latents, photo_latents = prepare(images, *a, **k)
        sizes.append((tuple(images[0].shape[-2:]) if images else None, tuple(latents.shape), None if photo_latents is None else tuple(photo_latents.shape)))
        return latents, photo_latents
    pipe.prepare_latents = watching
    quiet, generate.say = generate.say, lambda **kw: said.append(kw)
    said = []
    try:
        result = generate.edit(pipe, cut, mark, 'Remove what is marked.', os.path.join(work, 'a'), steps=6, seed=7, tries=2, write=True, origin=(1000, 2000))
    finally:
        generate.say = quiet
    read, noise, held = sizes[0]
    mw, mh = result['model_size']
    check('the photo is read at the size the answer is made at', read == (mh, mw) and noise == held, f'read at {read[1]} x {read[0]}, answer {mw} x {mh}, tiles {noise[1]}')
    check('two tries, each a patch at the photo\'s own pixels and a small one to look at',
          len(result['tries']) == 2 and all(os.path.isfile(os.path.join(work, 'a', t[k])) for t in result['tries'] for k in ('file', 'small')))
    t = result['tries'][0]
    patch = Image.open(os.path.join(work, 'a', t['file']))
    x0, y0, x1, y1 = t['box']
    check('the patch is where the mark is, in the picture it was cut from', patch.mode == 'RGBA' and patch.size == (x1 - x0, y1 - y0) and 1000 + 200 <= x0 <= 1000 + 260 and 2000 + 140 <= y0 <= 2000 + 200 and 1000 + 400 <= x1 <= 1000 + 460 and 2000 + 320 <= y1 <= 2000 + 380, f'{t["box"]}')
    check('each try starts from its own seed', [x['seed'] for x in result['tries']] == [7, 8])
    check('the reader wrote the instruction out (random weights, so not words)', result['prompt_by'] == 'engine' and result['prompt'] != 'Remove what is marked.', json.dumps(result['prompt'])[:60] + ' ' + json.dumps(result['note']))
    check('progress is said for the instruction, every step and every try', [s['stage'] for s in said].count('generate') == 12 and said[0]['stage'] == 'prompt' and [s['stage'] for s in said].count('tried') == 2)

    # The held part: with the hold, what is outside the mark is the photo as this VAE returns it; without, it is whatever the model painted.
    small = cut.resize((mw, mh), Image.LANCZOS)
    mark_s = np.asarray(mark.resize((mw, mh), Image.BILINEAR)) >= 64
    free = gp.free_tiles(mark_s)

    call = dict(prompt='x', image=small, height=mh, width=mw, output_resolution=(mw * mh) ** 0.5, num_inference_steps=6)
    hold = generate.Hold(pipe, free)
    with hold:
        last = pipe(callback_on_step_end=lambda _p, i, _t, kw: {**kw, 'latents': hold.after(i, kw['latents'])}, output_type='latent',
                    generator=torch.Generator('cpu').manual_seed(7), **call).images
    loose = pipe(output_type='latent', generator=torch.Generator('cpu').manual_seed(7), **call).images
    held_tiles = torch.from_numpy(~free.reshape(-1))
    off = float((last[0, held_tiles] - hold.photo[0, held_tiles]).abs().max())
    off_loose = float((loose[0, held_tiles] - hold.photo[0, held_tiles]).abs().max())
    check('every tile outside the mark ends as the photo\'s own, exactly', off < 1e-5 and off_loose > 0.01, f'furthest tile off by {off:.6f} with the hold, {off_loose:.2f} without')
    free_tiles = torch.from_numpy(free.reshape(-1))
    moved = float((last[0, free_tiles] - hold.photo[0, free_tiles]).abs().mean())
    check('inside it the model painted', moved > 0.01, f'mean change {moved:.2f}')
    check('the tiles are in the order the picture is', last.shape[1] == free.size and free.shape == (mh // 16, mw // 16))
    check('the pipeline is left as it was found', pipe.prepare_latents is watching)
    with hold:
        pipe(output_type='latent', generator=torch.Generator('cpu').manual_seed(7), **call)
    seen = generate.seen_by(pipe, hold, mw, mh)
    with torch.no_grad():
        px = pipe.image_processor.preprocess(small.convert('RGBA'), width=mw, height=mh).unsqueeze(2)
        through = pipe.image_processor.postprocess(vae.decode(vae.encode(px).latent_dist.mode(), return_dict=False)[0][:, :, 0])[0].convert('RGB')
    check('the photo as the coder returns it is the photo coded and decoded, nothing else', seen.size == (mw, mh) and psnr(seen, through) > 60, f'{psnr(seen, through):.1f} dB')

    # The whole picture: nothing to hold, no instruction to write out.
    said.clear()
    generate.say = lambda **kw: said.append(kw)
    try:
        result = generate.edit(pipe, cut, Image.new('L', cut.size, 255), 'Make it dusk.', os.path.join(work, 'b'), steps=3, tries=1)
    finally:
        generate.say = quiet
    t = result['tries'][0]
    check('the whole picture comes back as one patch the size of the picture', t['box'] == [0, 0, 640, 512] and Image.open(os.path.join(work, 'b', t['file'])).size == (640, 512) and result['prompt_by'] == 'instruction')


def main():
    part_one()
    part_two()
    print(f'{problems} problem(s)')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
