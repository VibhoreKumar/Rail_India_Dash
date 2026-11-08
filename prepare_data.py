"""Convert fresh Gold exports (CSV or Parquet) to dashboard JSON.
Run inside dashboard folder: python3 -m pip install pyarrow && python3 prepare_data.py
Copy one part-*.csv per Gold dataset into data/<dataset>/, or data/<dataset>.csv.
Parquet exports data/<dataset>.parquet are also supported.
"""
from pathlib import Path
import csv, json, math
from datetime import date, datetime, time
ROOT=Path(__file__).resolve().parent
DATA=ROOT/'data'
NAMES=('overall_kpis','train_performance','station_performance','station_recovery','monthly_performance','yearly_performance')

def clean(v):
    if isinstance(v,(date,datetime,time)): return v.isoformat()
    if isinstance(v,float) and not math.isfinite(v): return None
    if isinstance(v,bytes): return v.decode('utf-8','replace')
    if isinstance(v,dict): return {str(k):clean(x) for k,x in v.items()}
    if isinstance(v,(list,tuple)): return [clean(x) for x in v]
    return v

def find_input(name):
    candidates=[DATA/(name+'.csv'), DATA/name, DATA/(name+'.parquet')]
    for p in candidates:
        if p.is_file(): return p
        if p.is_dir():
            parts=sorted(p.glob('part-*.csv'))
            if len(parts)==1: return parts[0]
            if len(parts)>1: raise RuntimeError(f'{name}: found {len(parts)} CSV parts; expected one')
    if name=='monthly_performance':
        p=DATA/'monthly_prformance.csv'
        if p.exists(): return p
    raise FileNotFoundError(f'{name}: copy latest CSV to data/{name}.csv or data/{name}/part-*.csv (or Parquet).')

def read(p):
    if p.suffix=='.parquet':
        import pyarrow.parquet as pq
        return pq.read_table(p).to_pylist()
    with p.open(newline='',encoding='utf-8-sig') as f:
        rows=list(csv.DictReader(f))
    # Numeric columns are parsed for charts; identifiers, codes, names, types and date strings are preserved.
    for r in rows:
        for k,v in list(r.items()):
            if v is None or v.strip()=='' or v.lower()=='null': r[k]=None; continue
            if k in {'train_no','station_code','train_name','train_type','year_month','month_name'} or k.endswith('_date'):
                continue
            try:
                if v.strip().lstrip('-').isdigit(): r[k]=int(v)
                else: r[k]=float(v)
            except ValueError: pass
    return rows

DATA.mkdir(exist_ok=True)
counts={}
for name in NAMES:
    source=find_input(name)
    rows=read(source)
    if not rows: raise ValueError(f'{name}: empty source {source}')
    if name=='overall_kpis' and len(rows)!=1: raise ValueError('overall_kpis must have one row')
    (DATA/(name+'.json')).write_text(json.dumps(clean(rows),ensure_ascii=False,allow_nan=False),encoding='utf-8')
    counts[name]=len(rows)
    print(f'OK {name}: {len(rows):,} rows from {source.name}')
# The UI reads this JSON directly; avoid stale monthly_prformance.csv.
(DATA/'monthly_performance.json').exists() or (_ for _ in ()).throw(RuntimeError('Monthly JSON missing'))
(DATA/'export_manifest.json').write_text(json.dumps({'counts':counts},indent=2),encoding='utf-8')
print('All six current Gold datasets converted. Run python3 -m http.server 8000')
