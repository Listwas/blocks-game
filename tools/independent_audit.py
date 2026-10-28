"""Independent placement/clear simulation for all generated existence witnesses."""
import json,sys
cases=json.load(open(sys.argv[1]))
for case in cases:
    board=case['board'][:]
    used=set()
    for step in case['witness']:
        slot=step['slot'];assert slot not in used and 0<=slot<3
        used.add(slot)
        ids=[]
        for x,y in case['pieces'][slot]:
            r,c=step['row']+y,step['col']+x
            assert 0<=r<8 and 0<=c<8
            i=r*8+c;assert board[i]==0
            ids.append(i)
        for i in ids:board[i]=1
        rows={r for r in range(8) if all(board[r*8+c] for c in range(8))}
        cols={c for c in range(8) if all(board[r*8+c] for r in range(8))}
        for r in range(8):
            for c in range(8):
                if r in rows or c in cols:board[r*8+c]=0
    assert len(used)==3
print(f'Independent Python simulation proved all {len(cases)} complete trays playable.')
