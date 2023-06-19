#-------------------------------------------------------------------------------
# Name:        module1
# Purpose:
#
# Author:      ngihy
#
# Created:     05/05/2023
# Copyright:   (c) ngihy 2023
# Licence:     <your licence>
#-------------------------------------------------------------------------------

def main():
    pass

if __name__ == '__main__':
    main()

out = []
with open('nagai_problem500_answer.txt', 'r', encoding='UTF-8') as f:
    data = f.readlines()

    line = []
    for i,dt in enumerate(data):
        dt = dt.replace("\n", "")
        dt = dt.replace(" ", "")
        print(dt)
        mod = (i+1) % 11
        if(mod > 2):
            line.append(dt)
        elif(mod == 0):
            line.append(dt)
            out.append(''.join(line))
            line = []
    with open('answer.txt', 'w', encoding='UTF-8') as fo:
        fo.write('\n'.join(out))

out = []

with open('Problem500.txt', 'r', encoding='UTF-8') as f:
    data = f.readlines()
    line = []
    for i,dt in enumerate(data):
        dt = dt.replace("\n", "")
        dt = dt.replace(" ", "")
        print(dt)
        mod = (i+1) % 10
        if(mod > 1):
            line.append(dt)
        elif(mod == 0):
            line.append(dt)
            out.append(''.join(line))
            line = []
    with open('problem.txt', 'w', encoding='UTF-8') as fo:
        fo.write('\n'.join(out))
