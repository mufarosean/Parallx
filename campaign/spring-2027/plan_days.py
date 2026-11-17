"""Spring 2027 study plan, day by day: floor, standard and stretch.

Rules agreed with the owner on 2026-11-17 (the harness discussion, see the
Study entry in docs/MASTER_LIST.md on dev). Work study is the same in every
plan (130 h: 2 h Mon-Thu from Thu Jan 14 to Apr 4, then 4 h Mon-Fri for the
last two weeks); only personal hours differ. Exam: Tue Apr 20, 2027, the last
day of the CAS window. Run: python3 plan_days.py  (writes the .xlsx and .csv here)
"""
import os; os.chdir(os.path.dirname(os.path.abspath(__file__)))
import datetime as dt, collections, json
D=dt.date
start, end = D(2026,12,7), D(2027,4,19)
exam = D(2027,4,20)
def rng(a,b):
    d=a
    while d<=b: yield d; d+=dt.timedelta(1)
holidays=set(rng(D(2026,12,21),D(2027,1,3)))
rest_long=set()
for a in [D(2027,1,22),D(2027,2,12),D(2027,3,19)]:
    rest_long |= {a, a+dt.timedelta(1), a+dt.timedelta(2)}
rest_single={D(2027,4,3)}
catchup={D(2027,1,21),D(2027,2,11),D(2027,3,18),D(2027,4,1)}
ramp=D(2027,2,15)
half=set(rng(D(2027,4,5),D(2027,4,11)))
off=set(rng(D(2027,4,12),D(2027,4,18)))
def phase(d):
    for a,b,p in [(D(2026,12,7),D(2026,12,20),"Read only"),(D(2027,1,4),D(2027,1,24),"Read and notes"),
                  (D(2027,1,25),D(2027,2,14),"Read, problems, recipes"),(D(2027,2,15),D(2027,3,21),"Every problem, mixed"),
                  (D(2027,3,22),D(2027,4,4),"Hard ones + source review"),(D(2027,4,5),D(2027,4,18),"Practice exams + mixed quizzes")]:
        if a<=d<=b: return p
    if d in holidays: return "Holidays"
    return "Light review (not counted)"
def week(d):
    if d<D(2026,12,21): return "A" if d<D(2026,12,14) else "B"
    if d in holidays: return "-"
    if d>D(2027,4,18): return "-"
    return str((d-D(2027,1,4)).days//7+1)
def work(d):
    wd=d.weekday()
    if d in half or d in off: return 4 if wd<=4 else 0
    if D(2027,1,14)<=d<=D(2027,4,4) and wd<=3: return 2
    return 0
def personal(d,plan):
    wd=d.weekday()
    if d in holidays or d in rest_long or d in rest_single or d>D(2027,4,18): return 0
    if d in off:
        if plan=="Floor": return {5:6,6:4}.get(wd,2)
        if plan=="Standard": return {5:8,6:4}.get(wd,4)
        return {5:8,6:8}.get(wd,4)
    if wd==4:
        if d in half and plan=="Stretch": return 2
        return 0
    if wd>=5: return {"Floor":3,"Standard":4,"Stretch":5}[plan]
    # Mon-Thu
    morning=2
    if plan=="Floor": eve = 1 if d>=ramp else 0
    elif plan=="Standard": eve = 2 if d>=ramp else 1
    else: eve=2
    extra = 2 if (plan=="Stretch" and d in half) else 0
    return morning+eve+extra
def label(d):
    if d in holidays: return "Holiday"
    if d in rest_long or d in rest_single: return "Rest"
    if d.weekday()==4 and not (d in half or d in off): return "Rest (Friday)"
    if d in catchup: return "Catch-up"
    if d in half: return "Half day" if d.weekday()<=4 else "Weekend"
    if d in off: return "Off work"
    if d>D(2027,4,18): return "Day before exam"
    return "Weekend" if d.weekday()>=5 else "Workday"
plans={}
for plan in ["Floor","Standard","Stretch"]:
    rows=[];run=0
    for d in rng(start,end):
        p=personal(d,plan); w=work(d); run+=p+w
        rows.append(dict(date=d,day=d.strftime("%a"),week=week(d),phase=phase(d),kind=label(d),personal=p,work=w,total=p+w,running=run))
    plans[plan]=rows
    print(plan, "personal",sum(r['personal'] for r in rows),"work",sum(r['work'] for r in rows),"total",run)

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
wb=openpyxl.Workbook(); wb.remove(wb.active)
head=Font(bold=True); fills={"Holiday":"EEEEEE","Rest":"DDEBF7","Rest (Friday)":"DDEBF7","Catch-up":"FFF2CC","Half day":"E2EFDA","Off work":"C6E0B4","Day before exam":"FCE4D6"}
def sheet(name,rows):
    ws=wb.create_sheet(name)
    cols=["Date","Day","Week","Phase","Type","Personal","Work","Total","Running total"]
    ws.append(cols)
    for c in ws[1]: c.font=head
    for r in rows:
        ws.append([r['date'],r['day'],r['week'],r['phase'],r['kind'],r['personal'],r['work'],r['total'],r['running']])
        f=fills.get(r['kind'])
        if f:
            for c in ws[ws.max_row]: c.fill=PatternFill("solid",fgColor=f)
    n=ws.max_row
    ws.append(["Total","","","","",f"=SUM(F2:F{n})",f"=SUM(G2:G{n})",f"=SUM(H2:H{n})",""])
    for c in ws[ws.max_row]: c.font=head
    for i,w in enumerate([12,6,6,30,16,10,8,8,13],1): ws.column_dimensions[get_column_letter(i)].width=w
    for row in ws.iter_rows(min_row=2,max_col=1):
        for c in row: c.number_format="ddd mmm d, yyyy" if False else "mmm d, yyyy"
    ws.freeze_panes="A2"
for p in ["Floor","Standard","Stretch"]: sheet(p,plans[p])
ws=wb.create_sheet("Side by side",0)
ws.append(["Date","Day","Week","Phase","Type","Work","Floor personal","Floor total","Floor running","Standard personal","Standard total","Standard running","Stretch personal","Stretch total","Stretch running"])
for c in ws[1]: c.font=head
for a,b,c in zip(plans["Floor"],plans["Standard"],plans["Stretch"]):
    ws.append([a['date'],a['day'],a['week'],a['phase'],a['kind'],a['work'],a['personal'],a['total'],a['running'],b['personal'],b['total'],b['running'],c['personal'],c['total'],c['running']])
    f=fills.get(a['kind'])
    if f:
        for cell in ws[ws.max_row]: cell.fill=PatternFill("solid",fgColor=f)
for row in ws.iter_rows(min_row=2,max_col=1):
    for c in row: c.number_format="mmm d, yyyy"
for i,w in enumerate([12,6,6,30,16,6,9,9,9,10,10,10,9,9,9],1): ws.column_dimensions[get_column_letter(i)].width=w
ws.freeze_panes="F2"
n=ws.max_row
ws.append(["Total","","","","",f"=SUM(F2:F{n})",f"=SUM(G2:G{n})",f"=SUM(H2:H{n})","",f"=SUM(J2:J{n})",f"=SUM(K2:K{n})","",f"=SUM(M2:M{n})",f"=SUM(N2:N{n})",""])
for c in ws[ws.max_row]: c.font=head
wb.save("Study Plan 2027 Day by Day.xlsx")
# csv of standard too
import csv
with open("Study Plan 2027 Day by Day.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["Date","Day","Week","Phase","Type","Work","Floor personal","Floor total","Standard personal","Standard total","Stretch personal","Stretch total"])
    for a,b,c in zip(plans["Floor"],plans["Standard"],plans["Stretch"]):
        w.writerow([a['date'].isoformat(),a['day'],a['week'],a['phase'],a['kind'],a['work'],a['personal'],a['total'],b['personal'],b['total'],c['personal'],c['total']])
print("ok")
