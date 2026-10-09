/* Small Unicode launcher for the private, relocatable CPython runtime.
   Built with clang/lld without a CRT; all child paths derive from this EXE. */
typedef unsigned short WCHAR;
typedef unsigned long DWORD;
typedef int BOOL;
typedef void *HANDLE;
typedef struct { DWORD cb; WCHAR *reserved,*desktop,*title; DWORD x,y,xsize,ysize,
  xchars,ychars,fill,flags; unsigned short show,reserved2; unsigned char *data;
  HANDLE input,output,error; } STARTUPINFOW;
typedef struct { HANDLE process,thread; DWORD pid,tid; } PROCESS_INFORMATION;
__declspec(dllimport) DWORD __stdcall GetModuleFileNameW(HANDLE,WCHAR*,DWORD);
__declspec(dllimport) WCHAR *__stdcall GetCommandLineW(void);
__declspec(dllimport) BOOL __stdcall CreateProcessW(WCHAR*,WCHAR*,void*,void*,BOOL,DWORD,void*,WCHAR*,STARTUPINFOW*,PROCESS_INFORMATION*);
__declspec(dllimport) DWORD __stdcall WaitForSingleObject(HANDLE,DWORD);
__declspec(dllimport) BOOL __stdcall GetExitCodeProcess(HANDLE,DWORD*);
__declspec(dllimport) BOOL __stdcall CloseHandle(HANDLE);
__declspec(dllimport) void __stdcall ExitProcess(DWORD);
__declspec(dllimport) int __stdcall MessageBoxW(HANDLE,const WCHAR*,const WCHAR*,unsigned int);
#ifndef SCRIPT
#define SCRIPT L"SchemaCraft.py"
#endif
static WCHAR directory[32768], python[32768], script[32768], command[65536];
static int append(WCHAR *to,int offset,const WCHAR *from,int limit) {
  while (*from) { if(offset>=limit-1) ExitProcess(122);to[offset++]=*from++; }
  to[offset]=0;return offset;
}
void entry(void) {
  DWORD length=GetModuleFileNameW(0,directory,32768),code=1;
  if(!length||length>=32768) ExitProcess(122);
  while(length && directory[length-1]!='\\' && directory[length-1]!='/') --length;
  if(!length) ExitProcess(3);
  directory[length-1]=0;
  int p=append(python,0,directory,32768);
  append(python,p,L"\\vendor\\python\\pythonw.exe",32768);
  p=append(script,0,directory,32768);append(script,p,L"\\" SCRIPT,32768);
  int c=append(command,0,L"\"",65536);c=append(command,c,python,65536);
  c=append(command,c,L"\" -B \"",65536);c=append(command,c,script,65536);
  c=append(command,c,L"\"",65536);
  WCHAR *arguments=GetCommandLineW();
  if(*arguments=='\"') { ++arguments;while(*arguments&&*arguments!='\"') ++arguments;if(*arguments) ++arguments; }
  else while(*arguments&&*arguments!=' '&&*arguments!='\t') ++arguments;
  append(command,c,arguments,65536);
  STARTUPINFOW startup={0};PROCESS_INFORMATION process={0};startup.cb=sizeof(startup);
  if(!CreateProcessW(python,command,0,0,0,0,0,directory,&startup,&process)) {
    MessageBoxW(0,L"Cannot start the bundled Python runtime. Extract the entire ZIP to a writable local folder, then run this launcher again.",L"SchemaCraft",0x10);
    ExitProcess(1);
  }
  CloseHandle(process.thread);WaitForSingleObject(process.process,0xffffffff);
  GetExitCodeProcess(process.process,&code);CloseHandle(process.process);ExitProcess(code);
}
