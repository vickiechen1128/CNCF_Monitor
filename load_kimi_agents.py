import os
import yaml

# 定义 .kimi 目录路径
KIMI_DIR = "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree/.kimi"
AGENTS_DIR = os.path.join(KIMI_DIR, "agents")

# 加载 YAML 配置文件
def load_agent_config(agent_name):
    yaml_path = os.path.join(AGENTS_DIR, f"{agent_name}.yaml")
    with open(yaml_path, 'r') as f:
        return yaml.safe_load(f)

# 示例：加载并打印 orchestrator 配置
if __name__ == "__main__":
    config = load_agent_config("orchestrator")
    print("Loaded agent config:", config)