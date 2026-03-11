from .router import create_goal_router
from .service import init_goal_module as init_goal_module_v1
from .service_v2 import init_goal_module_v2


async def init_goal_module(db):
    await init_goal_module_v1(db)
    await init_goal_module_v2(db)

__all__ = ["create_goal_router", "init_goal_module"]
