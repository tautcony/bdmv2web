import json, sys, io, collections, png, re
from pathlib import Path
from PIL import Image, ImageChops
from igstools.parser import igs_decoded_segments, m2ts_igs_stream, PICTURE_SEGMENT, PALETTE_SEGMENT, BUTTON_SEGMENT
from igstools.model import Palette, Picture
from igstools.export import picture_to_png
source=Path(sys.argv[1]); project=Path(sys.argv[2]); output=Path(sys.argv[3]); output.mkdir(exist_ok=True)
with source.open('rb') as f: segments=list(igs_decoded_segments(m2ts_igs_stream(f)))
palettes={s['raw_data'][0]:Palette(s) for s in segments if s['seg_type']==PALETTE_SEGMENT}
pictures={(s['id'],s['ver']):Picture(s) for s in segments if s['seg_type']==PICTURE_SEGMENT}
assets=json.loads((project/'source-map.json').read_text())['assets']; results=[]
button_segments=[s for s in segments if s['seg_type']==BUTTON_SEGMENT]
if len(button_segments)!=1: raise ValueError('Expected exactly one composition for this comparison')
references=set(); state_count=0; ranges=[]
for page in button_segments[0]['pages']:
 for bog in page['bogs']:
  for button in bog['buttons']:
   for state in button['states'].values():
    start,end=state['start'],state['stop']
    if start==65535: continue
    state_count+=1
    if end==65535: end=start
    if end<start: raise ValueError('Invalid object range')
    if end>start: ranges.append([start,end])
    references.update((page['id'],page['palette'],obj) for obj in range(start,end+1))
actual_refs={(int(re.search(r'-p(\d+)-o',a['assetId']).group(1)),a['paletteId'],a['objectId']) for a in assets}
coverage={'button_state_references':state_count,'unique_referenced_elements':len(references),'missing':sorted(references-actual_refs),'extra':sorted(actual_refs-references),'multi_frame_ranges':ranges}

for i,a in enumerate(assets):
 oid=a['objectId']; ver=a['objectVersion']; pal=a['paletteId']; key=(oid,ver)
 if key not in pictures or pal not in palettes: results.append({'object':oid,'palette':pal,'status':'missing-reference'}); continue
 b=io.BytesIO(); picture_to_png(pictures[key],palettes[pal],b,matrix='709',tv_range=True); b.seek(0)
 width,height,rows,info=png.Reader(file=b).read(); raw=bytearray()
 for row in rows: raw.extend((value+128)//257 for value in row)
 reference=Image.frombytes('RGBA',(width,height),bytes(raw)); actual=Image.open(project/a['path']).convert('RGBA')
 if actual.size!=reference.size: results.append({'object':oid,'palette':pal,'status':'size-mismatch','actual':actual.size,'reference':reference.size});continue
 diff=ImageChops.difference(actual,reference); hist=diff.histogram(); sums=[sum(v for v in hist[k*256+1:(k+1)*256]) for k in range(4)]
 diff_pixels=sum(n for n,value in diff.getcolors(actual.width*actual.height) if value != (0,0,0,0))
 alpha=reference.getchannel('A'); vis=alpha.point(lambda x:255 if x else 0); channels=diff.split(); rgb_diff=ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2]); visible_diff=ImageChops.multiply(rgb_diff.point(lambda x:255 if x else 0),vis)
 visible= sum(visible_diff.histogram()[1:])
 row={'object':oid,'version':ver,'palette':pal,'size':list(actual.size),'pixels':actual.width*actual.height,'different_pixels':diff_pixels,'visible_rgb_different_pixels':visible,'channel_differences':sums,'max_difference':list(diff.getextrema()),'status':'match' if diff_pixels==0 else 'different'}; results.append(row)
 if i<3:
  reference.save(output/f'object-{oid}-palette-{pal}-reference.png');actual.save(output/f'object-{oid}-palette-{pal}-project.png')
print(json.dumps({'coverage':coverage,'assets':len(assets),'status_counts':dict(collections.Counter(r['status'] for r in results)),'total_pixels':sum(r.get('pixels',0) for r in results),'different_pixels':sum(r.get('different_pixels',0) for r in results),'visible_rgb_different_pixels':sum(r.get('visible_rgb_different_pixels',0) for r in results),'results':results},indent=2),file=(output/'comparison.json').open('w'))
