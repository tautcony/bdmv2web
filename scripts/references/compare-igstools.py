import json, sys, io, collections, png, re
from pathlib import Path
from PIL import Image, ImageChops
from igstools.parser import igs_decoded_segments, m2ts_igs_stream, PICTURE_SEGMENT, PALETTE_SEGMENT, BUTTON_SEGMENT
from igstools.model import Palette, Picture
from igstools.export import picture_to_png
source=Path(sys.argv[1]); project=Path(sys.argv[2]); output=Path(sys.argv[3]); output.mkdir(parents=True, exist_ok=True)
with source.open('rb') as f: segments=list(igs_decoded_segments(m2ts_igs_stream(f)))
palettes={(s['raw_data'][0],s['raw_data'][1]):Palette(s) for s in segments if s['seg_type']==PALETTE_SEGMENT}
pictures={(s['id'],s['ver']):Picture(s) for s in segments if s['seg_type']==PICTURE_SEGMENT}
assets=json.loads((project/'source-map.json').read_text())['assets']; results=[]
button_segments=[s for s in segments if s['seg_type']==BUTTON_SEGMENT]
if len(button_segments)!=1: raise ValueError('Expected exactly one composition for this comparison')
references=set(); state_count=0; ranges=[]
picture_versions={}
for s in segments:
 if s['seg_type']==PICTURE_SEGMENT: picture_versions[s['id']]=s['ver']
palette_versions={}
for s in segments:
 if s['seg_type']==PALETTE_SEGMENT: palette_versions[s['raw_data'][0]]=s['raw_data'][1]
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
    for obj in range(start,end+1):
     if obj not in picture_versions or page['palette'] not in palette_versions:
      references.add((page['id'],page['palette'],obj,None if obj not in picture_versions else picture_versions[obj],None if page['palette'] not in palette_versions else palette_versions[page['palette']]))
     else:
      references.add((page['id'],page['palette'],obj,picture_versions[obj],palette_versions[page['palette']]))
actual_refs={(a['pageId'],a['paletteId'],a['objectId'],a['objectVersion'],a['paletteVersion']) for a in assets}
sort_key=lambda values:tuple(-1 if value is None else value for value in values)
coverage={'button_state_references':state_count,'unique_referenced_elements':len(references),'missing':sorted(references-actual_refs,key=sort_key),'extra':sorted(actual_refs-references,key=sort_key),'multi_frame_ranges':ranges}

for i,a in enumerate(assets):
 oid=a['objectId']; ver=a['objectVersion']; pal=a['paletteId']; key=(oid,ver)
 pal_ver=a['paletteVersion']; asset_id=a['assetId']
 if key not in pictures or (pal,pal_ver) not in palettes: results.append({'assetId':asset_id,'page':a['pageId'],'object':oid,'version':ver,'palette':pal,'palette_version':pal_ver,'status':'missing-reference'}); continue
 b=io.BytesIO(); picture_to_png(pictures[key],palettes[(pal,pal_ver)],b,matrix='709',tv_range=True); b.seek(0)
 width,height,rows,info=png.Reader(file=b).read(); raw=bytearray()
 for row in rows: raw.extend((value+128)//257 for value in row)
 reference=Image.frombytes('RGBA',(width,height),bytes(raw)); actual=Image.open(project/a['path']).convert('RGBA')
 safe_id=re.sub(r'[^A-Za-z0-9_.-]','_',asset_id)
 reference_path=output/'reference'/f'{safe_id}.png'; reference_path.parent.mkdir(parents=True,exist_ok=True); reference.save(reference_path)
 if actual.size!=reference.size: results.append({'assetId':asset_id,'page':a['pageId'],'object':oid,'version':ver,'palette':pal,'palette_version':pal_ver,'status':'size-mismatch','actual':list(actual.size),'reference':list(reference.size)});continue
 diff=ImageChops.difference(actual,reference); hist=diff.histogram(); sums=[sum(v for v in hist[k*256+1:(k+1)*256]) for k in range(4)]
 diff_pixels=sum(n for n,value in diff.getcolors(actual.width*actual.height) if value != (0,0,0,0))
 alpha=reference.getchannel('A'); vis=alpha.point(lambda x:255 if x else 0); channels=diff.split(); rgb_diff=ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2]); visible_diff=ImageChops.multiply(rgb_diff.point(lambda x:255 if x else 0),vis)
 visible= sum(visible_diff.histogram()[1:])
 row={'assetId':asset_id,'page':a['pageId'],'object':oid,'version':ver,'palette':pal,'palette_version':pal_ver,'size':list(actual.size),'pixels':actual.width*actual.height,'different_pixels':diff_pixels,'visible_rgb_different_pixels':visible,'channel_differences':sums,'max_difference':list(diff.getextrema()),'status':'match' if diff_pixels==0 else 'different','reference_png':str(reference_path.relative_to(output))}; results.append(row)
summary={'source':str(source),'tool':{'name':'SAPikachu/igstools','commit':'34a133150ca8b52237284da4d47d93911bcd4954','matrix':'BT.709','range':'limited','output':'16-bit RGBA reduced to 8-bit with (value + 128) // 257'},'coverage':coverage,'assets':len(assets),'status_counts':dict(collections.Counter(r['status'] for r in results)),'total_pixels':sum(r.get('pixels',0) for r in results),'different_pixels':sum(r.get('different_pixels',0) for r in results),'visible_rgb_different_pixels':sum(r.get('visible_rgb_different_pixels',0) for r in results),'results':results}
print(json.dumps(summary,indent=2),file=(output/'comparison.json').open('w'))
