#define _GNU_SOURCE
#include <linux/perf_event.h>
#include <sys/syscall.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <unistd.h>
#include <string.h>
#include <stdio.h>
#include <errno.h>
static long pe_open(struct perf_event_attr *a) {
  return syscall(__NR_perf_event_open, a, 0, -1, -1, 0);
}
int main(int argc, char **argv) {
  if (argc < 4) { fprintf(stderr, "usage: pe_count EVENT -- cmd...\n"); return 2; }
  struct perf_event_attr attr; memset(&attr, 0, sizeof(attr));
  attr.size = sizeof(attr); attr.disabled = 1; attr.exclude_kernel = 1; attr.exclude_hv = 1;
  if (!strcmp(argv[1], "hw_instructions")) { attr.type = PERF_TYPE_HARDWARE; attr.config = PERF_COUNT_HW_INSTRUCTIONS; }
  else if (!strcmp(argv[1], "task_clock")) { attr.type = PERF_TYPE_SOFTWARE; attr.config = PERF_COUNT_SW_TASK_CLOCK; attr.exclude_kernel = 0; }
  else if (!strcmp(argv[1], "page_faults")) { attr.type = PERF_TYPE_SOFTWARE; attr.config = PERF_COUNT_SW_PAGE_FAULTS; }
  else { fprintf(stderr, "unknown event\n"); return 2; }
  int sep = 2; while (sep < argc && strcmp(argv[sep], "--")) sep++;
  if (sep >= argc - 1) { fprintf(stderr, "need -- cmd\n"); return 2; }
  int fd = (int)pe_open(&attr);
  if (fd < 0) { fprintf(stderr, "perf_event_open: %s\n", strerror(errno)); return 1; }
  ioctl(fd, PERF_EVENT_IOC_RESET, 0);
  ioctl(fd, PERF_EVENT_IOC_ENABLE, 0);
  pid_t pid = fork();
  if (pid == 0) { execvp(argv[sep+1], &argv[sep+1]); _exit(127); }
  int st = 0; waitpid(pid, &st, 0);
  ioctl(fd, PERF_EVENT_IOC_DISABLE, 0);
  long long count = 0; read(fd, &count, sizeof(count)); close(fd);
  fprintf(stderr, "pe_count,%s,%lld\n", argv[1], count);
  return WIFEXITED(st) ? WEXITSTATUS(st) : 1;
}
